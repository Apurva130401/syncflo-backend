// ===================================================================================
// --- Final SyncFlo Backend Server ---
// This version includes the missing /api/subscribe route and all necessary logic.
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
// This uses the keys you set in Render's environment variables.
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


// ===================================================================================
// --- THIS IS THE MISSING ROUTE THAT FIXES THE BUTTON ---
// ===================================================================================
app.post('/api/subscribe', async (req, res) => {
    const { userId, planId } = req.body;
    if (!userId || !planId) {
        return res.status(400).json({ error: 'User ID and Plan ID are required.' });
    }

    try {
        // Step 1: Create a subscription on Razorpay
        const razorpaySubscription = await razorpay.subscriptions.create({
            plan_id: planId, // This MUST match a plan ID in your Razorpay account
            customer_notify: 1,
            total_count: 12, // For a yearly plan; adjust as needed
        });

        // Step 2: Save the subscription record in your database
        const nextBillingDate = new Date();
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        await pool.query(
            'INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, next_billing_date) VALUES ($1, $2, $3, $4, $5)',
            [razorpaySubscription.id, userId, planId, 'created', nextBillingDate]
        );

        // Step 3: Send the subscription ID back to the frontend to open the checkout
        res.json({ id: razorpaySubscription.id });

    } catch (err) {
        console.error('Error in /api/subscribe:', err.message);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});


// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
