    // backend/index.js

    // Load environment variables from .env file
    require('dotenv').config();

    // Import the Express library
    const express = require('express');
    // Import the Supabase client library
    const { createClient } = require('@supabase/supabase-js');

    // --- Supabase Initialization ---
    // Get Supabase URL and Service Key from environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    // Check if Supabase credentials are provided
    if (!supabaseUrl || !supabaseKey) {
        console.error("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file");
        process.exit(1); // Exit the process if keys are missing
    }

    // Create a Supabase client instance
    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            // Optionally configure auth settings if needed, e.g.,
            // autoRefreshToken: true,
            // persistSession: false, // Typically false for server-side
            // detectSessionInUrl: false
        }
    });
    // --- End Supabase Initialization ---


    // Create an instance of an Express application
    const app = express();

    // --- Middleware ---
    // Add middleware to parse JSON request bodies
    app.use(express.json());
    // --- End Middleware ---


    // Define the port the server will listen on
    const PORT = process.env.PORT || 3000;

    // --- API Routes ---

    // Root route (for basic testing)
    app.get('/', (req, res) => {
      res.send('Hello from the Translo Backend!');
    });

    // Authentication Routes
    const authRouter = express.Router();

    // POST /api/auth/signup
    authRouter.post('/signup', async (req, res) => {
        const { email, password, username } = req.body; // Get username too

        // Basic validation
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'Email, password, and username are required' });
        }

        try {
            // Use Supabase to sign up the user
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    // Store additional data like username in user_metadata
                    // You might need to configure your Supabase project to allow this
                    // or create a separate 'profiles' table later.
                    data: {
                        username: username
                    }
                }
            });

            if (error) {
                console.error('Supabase signup error:', error.message);
                // Provide more specific error messages if possible
                return res.status(400).json({ error: error.message || 'Signup failed' });
            }

            // Important: Supabase often requires email confirmation by default.
            // The 'user' object might be null until confirmed, but 'session' might be present.
            // Check the response structure based on your Supabase settings.
            if (data.user) {
                 console.log('Signup successful for:', data.user.email);
                 // Depending on your email confirmation settings, the user might need to verify.
                 // You might want to return only a success message here, or the user/session if available.
                 res.status(201).json({ message: 'Signup successful! Please check your email for confirmation.', userId: data.user.id });
            } else if (data.session) {
                 // Handle cases where session is returned but user might need confirmation
                 res.status(201).json({ message: 'Signup successful (pending confirmation)!', session: data.session });
            }
             else {
                // Handle unexpected response from Supabase
                 console.warn('Supabase signup response structure unexpected:', data);
                 res.status(400).json({ error: 'Signup partially successful, but user data unavailable. Check confirmation settings.' });
            }


        } catch (err) {
            console.error('Server error during signup:', err);
            res.status(500).json({ error: 'Internal server error during signup' });
        }
    });

    // POST /api/auth/login
    authRouter.post('/login', async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        try {
            // Use Supabase to sign in the user
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                console.error('Supabase login error:', error.message);
                // Differentiate between invalid credentials and other errors
                if (error.message.includes('Invalid login credentials')) {
                     return res.status(401).json({ error: 'Invalid email or password' });
                }
                return res.status(400).json({ error: error.message || 'Login failed' });
            }

            // On successful login, Supabase returns user and session data
            if (data.session && data.user) {
                console.log('Login successful for:', data.user.email);
                // Return the session (contains access token) and user info
                // The frontend will need the access_token for subsequent authenticated requests
                res.status(200).json({
                    message: 'Login successful!',
                    access_token: data.session.access_token,
                    user: {
                        id: data.user.id,
                        email: data.user.email,
                        // Add other relevant user fields if needed
                        // username: data.user.user_metadata?.username // Example if stored in metadata
                    }
                 });
            } else {
                 console.warn('Supabase login response structure unexpected:', data);
                 res.status(400).json({ error: 'Login failed due to unexpected response.' });
            }

        } catch (err) {
            console.error('Server error during login:', err);
            res.status(500).json({ error: 'Internal server error during login' });
        }
    });

    // Mount the auth router under the /api/auth prefix
    app.use('/api/auth', authRouter);

    // --- End API Routes ---


    // Start the server and make it listen on the defined port
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      // Log Supabase URL to confirm it's loaded (optional)
      // console.log(`Supabase URL: ${supabaseUrl}`);
    });
    