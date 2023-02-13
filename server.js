import express from "express";
import * as dotenv from "dotenv";
import cors from "cors";
import { Configuration, OpenAIApi } from "openai";
import bodyParser from "body-parser";
import stripe from "stripe";
import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync(
    "E:/Coding Course/Github Repositories/serviceAccountKey.json",
    "utf-8"
  )
);

import { initializeApp } from "firebase-admin/app";
//Firebase ends here
// Initialize Firebase

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
//Firebase ends here
///OpenAI starts here
dotenv.config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

const app = express();
const port = 5000;
app.use(cors());
app.use(bodyParser.json());

app.post("/", async (req, res) => {
  const message = req.body; /// This is prompt coming from UI written by user as a message.
  const response = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `${message.message}`,
    temperature: 0,
    max_tokens: 100,
    top_p: 1,
    frequency_penalty: 0.5,
    presence_penalty: 0,
  });
  res.json({
    // data:response.data
    message: response.data.choices[0].text,
  });
});

app.post("/openai", async (req, res) => {
  const inputString = req.body.input;
  console.log(`Received input: ${inputString}`);
  const response = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `${inputString}`,
    temperature: 0,
    max_tokens: 100,
    top_p: 1,
    frequency_penalty: 0.5,
    presence_penalty: 0,
  });
  console.log(response.data.choices[0].text);
  // update the user's credits in Firestore database
  const userRef = admin.firestore().collection("users").doc(req.body.userId);
  const user = await userRef.get();
  await userRef.update({ credits: user.data().credits - 1 });
  // return success response to the frontend
  res.send(response.data.choices[0].text);
});
///OpenAI ends here
//Stripe starts here
const stripe2 = stripe(process.env.STRIPE_PRIVATE_KEY);

const storeItems = new Map([
  [1, { priceInCents: 74000, name: "Basic Plan" }],
  [2, { priceInCents: 404000, name: "Pro Plan" }],
  [3, { priceInCents: 816000, name: "Master Plan" }],
]);
let userId = "1111bc";
app.post("/create-checkout-session", async (req, res) => {
  try {
    const customer = await stripe2.customers.create({
      metadata:{
        userId: req.body.userId,
        planId: req.body.items[0].id
      }
    })
    userId = req.body.userId;
    const session = await stripe2.checkout.sessions.create({
      payment_method_types: ["card"],
      customer: customer.id,
      line_items: req.body.items.map((item) => {
        const storeItem = storeItems.get(item.id);
        return {
          price_data: {
            currency: "inr",
            product_data: {
              name: storeItem.name,
            },
            unit_amount: storeItem.priceInCents,
          },
          quantity: item.quantity,
        };
      }),
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/dashboard`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard`,
    });
    // if (session) {
    // // update the user's credits in Firestore database
    // const userRef = admin.firestore().collection('users').doc(req.body.userId);
    // const user = await userRef.get();
    // await userRef.update({ credits: user.data().credits + 100 });
    // return success response to the frontend
    res.json({ url: session.url, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// This is your Stripe CLI webhook secret for testing your endpoint locally.
let endpointSecret;
// endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let data;
    let eventType;

    if (endpointSecret) {
      let event;
      

      try {
        event = stripe2.webhooks.constructEvent(
          req.body,
          sig,
          endpointSecret
        );
        console.log("Webhook verified");
      } catch (err) {
        console.log(`Webhook Error ${err.message}`);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
      }
      data = event.data.object
      eventType = event.type
    }else{
      data = req.body.data.object
      eventType = req.body.type
    }

    // Handle the event
    if(eventType === "checkout.session.completed"){
      stripe2.customers.retrieve(data.customer).then(async (customer) => {
        const userRef = admin.firestore().collection('users').doc(customer.metadata.userId);
        const user = await userRef.get();
        await userRef.update({ credits: user.data().credits + 100 });
        await userRef.update({ planId: customer.metadata.planId});
      }).catch((e) => console.log(e.message))
    }

    // Return a 200 response to acknowledge receipt of the event
    res.send().end();
  }
);

//Stripe ends here
app.listen(port, () =>
  console.log(`Server is running on ${process.env.SERVER_URL} port:${port}`)
);
