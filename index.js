// ===================================================================================
// --- Final SyncFlo Backend Server ---
// This version includes the Nango webhook handler.
// ===================================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Razorpay Instance ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// --- API Routes ---

app.get('/', (req, res) => res.send('SyncFlo Backend is running!'));

app.post('/api/user/find-or-create', async (req, res) => {
  const { email, fullName } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length > 0) {
      res.json(user.rows[0]);
    } else {
      let newUser = await pool.query('INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING *', [email, fullName || 'New User']);
      res.status(201).json(newUser.rows[0]);
    }
  } catch (err) {
    console.error('Error in /api/user/find-or-create:', err.message);
    res.status(500).json({ error: 'Database error.' });
  }
});

app.get('/api/subscription/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(`SELECT s.*, p.name as plan_name, p.price_in_inr, p.features FROM subscriptions s JOIN plans p ON s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.status = 'active'`, [userId]);
        if (result.rows.length > 0) res.json(result.rows[0]);
        else res.status(404).json({ error: 'No active subscription found.' });
    } catch (err) {
        console.error('Error in /api/subscription/:userId:', err.message);
        res.status(500).json({ error: 'Database error.' });
    }
});

app.get('/api/billing-history/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM billing_history WHERE user_id = $1 ORDER BY invoice_date DESC', [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/billing-history/:userId:', err.message);
        res.status(500).json({ error: 'Database error.' });
    }
});

app.get('/api/plans', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM plans');
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/plans:', err.message);
        res.status(500).json({ error: 'Database error.' });
    }
});

app.post('/api/subscribe', async (req, res) => {
    const { userId, planId } = req.body;
    if (!userId || !planId) {
        return res.status(400).json({ error: 'User ID and Plan ID are required.' });
    }

    try {
        const razorpaySubscription = await razorpay.subscriptions.create({
            plan_id: planId,
            customer_notify: 1,
            total_count: 12,
        });

        const nextBillingDate = new Date();
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        await pool.query(
            'INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, next_billing_date) VALUES ($1, $2, $3, $4, $5)',
            [razorpaySubscription.id, userId, planId, 'created', nextBillingDate]
        );

        res.json({ id: razorpaySubscription.id });

    } catch (err) {
        console.error('Error in /api/subscribe:', JSON.stringify(err, null, 2));
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

// --- Nango Webhook Handler ---
// This is our "digital mailbox" to receive connection updates from Nango.
app.post('/api/webhooks/nango', async (req, res) => {
  console.log('✅ Received a webhook from Nango!');
  
  const webhook = req.body;

  // For security, you should verify the webhook signature in a real app,
  // but we'll skip that for now to keep this first test simple.

  // Check if this is a successful new connection webhook
  if (webhook.type === 'auth' && webhook.operation === 'creation' && webhook.success) {
    try {
      console.log('--- Full Nango Webhook Payload ---');
      console.log(JSON.stringify(webhook, null, 2));
      const connectionId = webhook.connectionId;
      const userId = webhook.endUser.endUserId; // This is your Supabase User ID
      const provider = webhook.provider; // e.g., 'notion', 'google-calendar'

      console.log(`Received new connection: User [${userId}] connected [${provider}] with ID [${connectionId}]`);

      // Logic to determine which column to update in your 'profiles' table
      const columnToUpdate = `${provider}_connection_id`; 
      // Make sure these column names match your 'profiles' table exactly!

      // Create the SQL query to update the user's record in the PROFILES table
      const query = `UPDATE profiles SET ${columnToUpdate} = $1 WHERE id = $2`;
      const values = [connectionId, userId];

      // Execute the query
      await pool.query(query, values);

      console.log(`Successfully saved connection ID for user ${userId} in column ${columnToUpdate}.`);
      
      res.status(200).send('Webhook received and processed.');

    } catch (err) {
      console.error('Error processing Nango webhook:', err.message);
      res.status(500).json({ error: 'Failed to process webhook.' });
    }
  } else {
    // If it's not a new connection webhook, just acknowledge it.
    res.status(200).send('Webhook acknowledged.');
  }
});


// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});