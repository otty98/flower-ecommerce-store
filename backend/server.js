const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Owethuu3!',
    database: process.env.DB_NAME || 'bloomstore',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00'
});

// Database connection test
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('✅ Database connection test successful');
        return true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        return false;
    }
};

// Products API
app.get('/api/products', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products ORDER BY id DESC');
        console.log(`✅ [GET /api/products] Retrieved ${results.length} products`);
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/products] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    const productId = parseInt(req.params.id);
    try {
        const [results] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
        if (results.length === 0) {
            console.log(`⚠️ [GET /api/products/${productId}] Product not found`);
            return res.status(404).json({ error: 'Product not found' });
        }
        console.log(`✅ [GET /api/products/${productId}] Retrieved product`);
        res.json(results[0]);
    } catch (err) {
        console.error(`❌ [GET /api/products/${productId}] Error:`, err.message);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Cart API - Complete Implementation
app.get('/api/cart', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM cart ORDER BY id DESC');
        console.log(`✅ [GET /api/cart] Retrieved ${results.length} cart items`);
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/cart] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch cart items' });
    }
});

app.post('/api/cart', async (req, res) => {
    const { id, quantity } = req.body;
    
    try {
        // Get product details
        const [productResults] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
        
        if (productResults.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        const product = productResults[0];
        
        // Check if item already exists in cart
        const [existingItems] = await pool.query('SELECT * FROM cart WHERE product_id = ?', [id]);
        
        if (existingItems.length > 0) {
            // Update existing item
            const newQuantity = quantity <= 0 ? 0 : quantity;
            
            if (newQuantity <= 0) {
                // Remove item if quantity is 0 or less
                await pool.query('DELETE FROM cart WHERE product_id = ?', [id]);
                console.log(`✅ [POST /api/cart] Removed product ${id} from cart`);
            } else {
                // Update quantity
                await pool.query('UPDATE cart SET quantity = ? WHERE product_id = ?', [newQuantity, id]);
                console.log(`✅ [POST /api/cart] Updated product ${id} quantity to ${newQuantity}`);
            }
        } else if (quantity > 0) {
            // Add new item
            await pool.query(
                'INSERT INTO cart (product_id, name, price, quantity) VALUES (?, ?, ?, ?)',
                [id, product.name, product.price, quantity]
            );
            console.log(`✅ [POST /api/cart] Added product ${id} to cart`);
        }
        
        res.json({ success: true, message: 'Cart updated successfully' });
    } catch (err) {
        console.error('❌ [POST /api/cart] Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update cart' });
    }
});

app.delete('/api/cart/:productId', async (req, res) => {
    const productId = parseInt(req.params.productId);
    
    try {
        await pool.query('DELETE FROM cart WHERE product_id = ?', [productId]);
        console.log(`✅ [DELETE /api/cart/${productId}] Removed from cart`);
        res.json({ success: true, message: 'Item removed from cart' });
    } catch (err) {
        console.error(`❌ [DELETE /api/cart/${productId}] Error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to remove item' });
    }
});

app.delete('/api/cart', async (req, res) => {
    try {
        await pool.query('DELETE FROM cart');
        console.log('✅ [DELETE /api/cart] Cleared entire cart');
        res.json({ success: true, message: 'Cart cleared' });
    } catch (err) {
        console.error('❌ [DELETE /api/cart] Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to clear cart' });
    }
});

// Orders API
app.post('/api/orders', async (req, res) => {
    try {
        const { paymentId, amount, items } = req.body;
        
        // 1. Save order to MySQL
        const [orderId] = await db.execute(
            'INSERT INTO orders (payment_id, amount, status) VALUES (?, ?, "completed")',
            [paymentId, amount]
        );
        
        // 2. Save order items
        for (const item of items) {
            await db.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId.insertId, item.id, item.quantity, item.price]
            );
        }
        
        res.json({ orderId: orderId.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Order failed' });
    }
});

app.post('/api/checkout', async (req, res) => {
    const cartItems = req.body;
    
    try {
        // Clear the cart after successful checkout
        await pool.query('DELETE FROM cart');
        console.log('✅ [POST /api/checkout] Checkout successful, cart cleared');
        res.json({ success: true, message: 'Order placed successfully' });
    } catch (err) {
        console.error('❌ [POST /api/checkout] Error:', err.message);
        res.status(500).json({ success: false, message: 'Checkout failed' });
    }
});

// Health Check
app.get('/health', async (req, res) => {
    const dbHealthy = await testConnection();
    res.json({
        status: dbHealthy ? 'healthy' : 'degraded',
        database: dbHealthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Start Server
const startServer = async () => {
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.error('❌ Failed to connect to database - exiting');
        process.exit(1);
    }

    const server = app.listen(port, () => {
        console.log(`\n🚀 Server running at: http://localhost:${port}`);
        console.log('📋 Available API endpoints:');
        console.log('   GET    /api/products      - Get all products');
        console.log('   GET    /api/products/:id  - Get single product');
        console.log('   GET    /api/cart          - Get cart items');
        console.log('   POST   /api/cart          - Add/update cart item');
        console.log('   DELETE /api/cart/:id      - Remove cart item');
        console.log('   DELETE /api/cart          - Clear cart');
        console.log('   POST   /api/orders        - Create order');
        console.log('   POST   /api/checkout      - Process checkout');
        console.log('   GET    /health            - Health check');
    });

    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down server...');
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    });
};

startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});