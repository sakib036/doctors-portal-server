const express = require('express');
const cors = require('cors');
const app = express();
const jwt = require('jsonwebtoken');
require('dotenv').config();

const stripe = require("stripe")(process.env.STRIPE_KEY);
const port = process.env.PORT || 5000;


app.use(cors())
app.use(express.json())




const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { query } = require('express');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.cez8utx.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}



async function run() {
    try {
        const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions');

        const bookingsCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();

        }

        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;

            const query = {};
            const options = await appointmentOptionsCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date };
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookSlot = optionBooked.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookSlot.includes(slot));
                option.slots = remainingSlots;
            })
            res.send(options)
        });

        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {};
            const result = await appointmentOptionsCollection.find(query).project({ name: 1 }).toArray();
            res.send(result)
        })

        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }


            const query = {
                email: email
            }
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings)
        })

        //   routes loader dashboard/payment/id
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;

            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }
            const alreadyAppoint = await bookingsCollection.find(query).toArray();

            if (alreadyAppoint.length) {
                const message = `You already have booked on ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message })

            }


            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        })

        // Payment stripe 

        app.post('/create-payment-intent', async(req,res)=>{
            const booking=req.body;
            const price=booking.price;
            const amount=price*100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency:'usd',
                amount:amount,
                "payment_method_types":[
                    'card'
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        })

    //  payment details store in checkoutform
        app.post('/payments', async(req,res)=>{
            const payment=req.body;
            const result= await paymentsCollection.insertOne(payment);
            const id=payment.bookingId;
            const filter={_id:ObjectId(id)}

            const updateDoc={
                $set:{
                    paid:true,
                    transactionId:payment.transactionId,
                }
            }
            const updatedResult=await bookingsCollection.updateOne(filter,updateDoc)
            res.send(result)
        })


        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = {
                email: email
            }
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })
        });

        app.get('/users', async (req, res) => {
            const query = {};
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        });

        // update  data like price update to appoint collection

        // app.get('/price', async(req,res)=>{
        //     const query={};
        //     const options={upsert:true};
        //     const updatePrice={
        //         $set:{
        //             price:99
        //         }
        //     }
        //     const result= await appointmentOptionsCollection.updateMany(query,updatePrice,options)
        //     res.send(result)
        // })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options)

            res.send(result)
        });

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors)
        })

        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        })

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(query)
            res.send(result)
        })



    }
    finally {

    }

}
run().catch(console.log)


app.get('/', async (req, res) => {
    res.send('doctors-portal is running')
})

app.listen(port, () => console.log(`Doctors portal is running on port ${port}`))