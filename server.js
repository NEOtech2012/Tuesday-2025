const path = require('path');
const express = require('express');
const fs = require('fs');
require('dotenv').config(); 

// --- TWILIO SETUP (Safe Mode) ---
// This prevents crashes if keys are missing
let client;
try {
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
        client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    }
} catch (e) { console.log("Twilio Error:", e.message); }

const app = express();

// --- DATABASE SETUP (File Based) ---
const DATA_FILE = 'orders.json';
let orders = [];

// Load Data Function
function loadOrders() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            if (!rawData.trim()) { orders = []; return; }
            const parsed = JSON.parse(rawData);
            orders = Array.isArray(parsed) ? parsed : [];
        } else {
            orders = [];
        }
    } catch (e) { 
        console.log("Database reset.");
        orders = []; 
    }
}

// Save Data Function
function saveOrders() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}
loadOrders();

// --- MIDDLEWARE ---

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');

// FIX: Explicitly tell Render where the folder is using __dirname
app.set('views', path.join(__dirname, 'views')); 

// FIX: Explicitly tell Render where CSS/Images are
app.use(express.static(path.join(__dirname, 'public'))); 

app.use(express.urlencoded({ extended: true }));

// (Notice: No 'express-session' here. You don't need it!)

// --- ROUTES ---

// 1. Home Page
app.get('/home', (req, res) => {
    res.render('home');
});

// 2. Next Button Logic
app.post('/order', (req, res) => {
    const promo = req.body.promoCode;
    let dest = '/temu';
    if (promo && promo.trim() !== "") dest += '?code=' + promo;
    res.redirect(dest);
});

// 3. Flash Sale Page
app.get('/temu', (req, res) => {
    res.render('temu', { savedCode: req.query.code });
});

// 4. CHECKOUT (Final Step)
app.post('/checkout', (req, res) => {
    const name = req.body.customerName;
    const sPhone = req.body.senderPhone;
    const rPhone = req.body.receiverPhone;
    const qty = parseInt(req.body.quantity);
    const promo = req.body.promoCode;

    // Price Logic
    let price = 500;
    let discount = false;
    if (promo && promo.toUpperCase() === 'KEBTYE10') {
        price = 450;
        discount = true;
    }
    const total = qty * price;

    // Create Order
    const newOrder = {
        id: Date.now(),
        name: name,
        senderPhone: sPhone,
        receiverPhone: rPhone,
        qty: qty,
        total: total,
        discount: discount,
        status: "Pending",
        time: new Date().toLocaleTimeString()
    };

    orders.push(newOrder);
    saveOrders();

    // WhatsApp Notification
    if (client && process.env.MY_PHONE_NUMBER) {
        client.messages.create({
            body: `📦 *NEW ORDER!*\n\n👤 ${name}\n📱 ${sPhone}\n🛍️ ${qty} Bags\n💰 ₦${total}`,
            from: process.env.TWILIO_PHONE,
            to: process.env.MY_PHONE_NUMBER
        }).catch(e => console.log("SMS Error:", e.message));
    }

    // Receipt
    res.render('receipt', { 
        id: newOrder.id, name, qty, total, discountApplied: discount, senderPhone: sPhone, receiverPhone: rPhone 
    });
});

// 5. Tracking
app.get('/track', (req, res) => res.render('track'));

app.get('/track-result', (req, res) => {
    loadOrders();
    const order = orders.find(o => o.id == req.query.orderId);
    if (order) res.render('track', { foundOrder: order });
    else res.render('track', { error: "Order Not Found." });
});

// 6. Admin
app.get('/admin', (req, res) => {
    loadOrders();
    res.render('admin', { orderList: orders });
});

// 7. Update Status
app.post('/update-status', (req, res) => {
    const id = req.body.orderId;
    const newStatus = req.body.newStatus;
    const idx = orders.findIndex(o => o.id == id);
    
    if (idx !== -1) {
        orders[idx].status = newStatus;
        saveOrders();

        // Delivery Notification
        if (newStatus === 'Delivered' && client && process.env.MY_PHONE_NUMBER) {
            client.messages.create({
                body: `✅ *DELIVERED!* \n\nHello ${orders[idx].name}, your order #${id} has arrived! 📦`,
                from: process.env.TWILIO_PHONE,
                to: process.env.MY_PHONE_NUMBER
            }).catch(e => console.log("Notify Error:", e.message));
        }
    }
    res.redirect('/admin');
});

// 8. Delete
app.post('/delete', (req, res) => {
    orders = orders.filter(o => o.id != req.body.idToDelete);
    saveOrders();
    res.redirect('/admin');
});

// 9. Root Redirect
app.get('/', (req, res) => res.redirect('/home'));

// 10. Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));