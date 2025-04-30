// backend/index.js

// Load environment variables from .env file
require('dotenv').config();

// Import the Express library
const express = require('express');
// Import the Supabase client library
const { createClient } = require('@supabase/supabase-js');
// *** Import the CORS middleware ***
const cors = require('cors');


// --- Supabase Initialization ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // Make sure this is in .env

// Validate that environment variables are loaded
if (!supabaseUrl || !supabaseKey || !supabaseAnonKey) {
    console.error("CRITICAL ERROR: Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY in .env file");
    console.error("Ensure the .env file exists in the 'backend' directory and contains all required keys.");
    process.exit(1); // Exit the process if keys are missing
}

// Create a Supabase client instance for server-side operations (using service key)
// This client bypasses RLS and is used for admin tasks or when user context isn't needed directly for the query.
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
// --- End Supabase Initialization ---


// Create an instance of an Express application
const app = express();

// --- Global Middleware ---
// *** Enable CORS for all origins (for development) ***
// This MUST come before your routes are defined.
// IMPORTANT: For production, configure specific origins: app.use(cors({ origin: 'YOUR_FRONTEND_DEPLOYMENT_URL' }));
app.use(cors());

// Add middleware to parse incoming JSON request bodies
app.use(express.json());
// --- End Global Middleware ---


// --- Custom Middleware ---
// Authentication Middleware: Verifies JWT token from Authorization header
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    // Check if the Authorization header exists and starts with "Bearer "
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
    }
    // Extract the token part after "Bearer "
    const token = authHeader.split(' ')[1];

    try {
        // Use the public ANON key to create a temporary client scoped to the user's token
        // This allows verifying the token against Supabase Auth without bypassing RLS by default.
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
             global: { headers: { Authorization: `Bearer ${token}` } }
        });
        // Fetch the user details based on the provided token
        const { data: { user }, error } = await supabase.auth.getUser(token);

        // Handle token validation errors or cases where the user is not found
        if (error || !user) {
             console.error('Auth error during token validation:', error?.message);
             return res.status(401).json({ error: 'Unauthorized: Invalid token or user session' });
        }

        // Attach the validated user object to the request object
        // Downstream route handlers can now access `req.user`
        req.user = user;
        console.log(`Authenticated user: ${user.id} (${user.email})`); // Log successful authentication
        next(); // Proceed to the next middleware or route handler in the chain
    } catch (err) {
        // Catch any unexpected errors during the authentication process
        console.error('Authentication middleware internal error:', err);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
};
// --- End Custom Middleware ---


// Define the port the server will listen on
const PORT = process.env.PORT || 3000;

// --- API Routes ---

// Root route (Simple check to see if the server is running)
app.get('/', (req, res) => {
  res.status(200).send('Hello from the Translo Backend!');
});

// --- Authentication Routes ---
const authRouter = express.Router();

// POST /api/auth/signup - User Registration
authRouter.post('/signup', async (req, res) => {
    const { email, password, username } = req.body; // Extract details from request body

    // Basic input validation
    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, password, and username are required' });
    }

    try {
        // 1. Sign up the user in Supabase Auth using the admin client
        const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
            email: email,
            password: password,
            options: { data: { username: username } } // Store username in metadata initially
        });

        if (authError) throw authError; // Propagate Supabase auth errors
        if (!authData.user) throw new Error('User registration failed in Supabase auth.'); // Should not happen if no error

        // 2. Create a corresponding profile entry in the 'profiles' table
        // Assumes 'profiles.id' column defaults to 'auth.uid()' or is manually set here
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert({
                id: authData.user.id, // Explicitly link profile to the new auth user ID
                username: username
             });

        if (profileError) {
             // If profile creation fails after auth user is created, log it.
             // Consider implementing a rollback (delete the auth user) for consistency.
             console.error('Error creating profile after signup:', profileError.message);
             // Optional: await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
             return res.status(500).json({ error: 'Signup succeeded but profile creation failed. Please contact support.' });
        }

        console.log('Signup and profile creation successful for:', authData.user.email);
        // Inform user about potential email confirmation step
        res.status(201).json({ message: 'Signup successful! Please check your email for confirmation if required.', userId: authData.user.id });

    } catch (err) {
        // Catch errors from either signUp or profile insert
        console.error('Signup process error:', err.message);
        // Return Supabase error status if available, otherwise 500
        res.status(err.status || 500).json({ error: err.message || 'Internal server error during signup' });
    }
});

// POST /api/auth/login - User Login
authRouter.post('/login', async (req, res) => {
    const { email, password } = req.body; // Extract credentials

    // Basic validation
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        // Attempt to sign in using Supabase Auth
        const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

        if (error) {
            // Handle specific login errors
            console.error('Supabase login error:', error.message);
            if (error.message.includes('Invalid login credentials')) {
                 return res.status(401).json({ error: 'Invalid email or password' }); // Use 401 for auth failure
            }
            // Handle other potential errors (e.g., email not confirmed)
            return res.status(400).json({ error: error.message || 'Login failed' });
        }

        // Check if session and user data are present in the response
        if (data.session && data.user) {
            console.log('Login successful for:', data.user.email);

            // Fetch the corresponding profile username
            const { data: profileData, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('username')
                .eq('id', data.user.id)
                .single(); // Expect exactly one profile per user ID

             if (profileError) {
                // Log error but proceed, maybe return username from metadata as fallback
                console.error("Error fetching profile username on login:", profileError.message);
             }

            // Return essential session and user info to the frontend
            res.status(200).json({
                message: 'Login successful!',
                access_token: data.session.access_token, // The JWT token for subsequent requests
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    // Provide username from profile if found, otherwise fallback
                    username: profileData?.username || data.user.user_metadata?.username || 'N/A'
                }
             });
        } else {
             // Handle unexpected successful response structure from Supabase
             console.warn('Supabase login response structure unexpected:', data);
             res.status(400).json({ error: 'Login failed due to unexpected server response.' });
        }
    } catch (err) {
        // Catch any unexpected server errors during the login process
        console.error('Server error during login:', err);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

// Mount the authentication router under the /api/auth prefix
app.use('/api/auth', authRouter);
// --- End Authentication Routes ---


// --- Users Routes ---
// Routes related to user searching, profiles etc. (excluding auth)
const usersRouter = express.Router();
usersRouter.use(authenticateUser); // Apply auth middleware to protect these routes

// GET /api/users/search?query=... - Search for users by username
usersRouter.get('/search', async (req, res) => {
    const searchQuery = req.query.query; // Get search term from query parameters
    const currentUserId = req.user.id; // Get ID of the user performing the search

    // Validate search query
    if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters long' });
    }

    try {
        // Search the 'profiles' table for matching usernames (case-insensitive)
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, username') // Select only the ID and username
            .ilike('username', `%${searchQuery}%`) // Case-insensitive pattern matching
            .neq('id', currentUserId) // Exclude the current user from results
            .limit(10); // Limit the number of results returned

        if (error) throw error; // Propagate database errors

        // Return the found users (or an empty array if none found)
        res.status(200).json(data || []);

    } catch (err) {
        console.error('Error searching users:', err.message);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// Mount the users router under the /api/users prefix
app.use('/api/users', usersRouter);
// --- End Users Routes ---


 // --- Friends Routes ---
 // Routes for managing friend relationships
 const friendsRouter = express.Router();
 friendsRouter.use(authenticateUser); // Apply auth middleware to all friend routes

 // POST /api/friends/request - Send a friend request (No changes needed here)
 friendsRouter.post('/request', async (req, res) => {
     const requesterId = req.user.id; // ID of the logged-in user sending the request
     const recipientId = req.body.recipientId; // ID of the user to receive the request
     if (!recipientId) return res.status(400).json({ error: 'Recipient ID is required' });
     if (requesterId === recipientId) return res.status(400).json({ error: 'Cannot send friend request to yourself' });
     try {
         const [user1, user2] = [requesterId, recipientId].sort();
         const { data: existing, error: checkError } = await supabaseAdmin
             .from('friendships')
             .select('id, status')
             .or(`and(user_id_1.eq.${user1},user_id_2.eq.${user2}),and(user_id_1.eq.${user2},user_id_2.eq.${user1})`)
             .maybeSingle();
         if (checkError) throw checkError;
         if (existing) {
             if (existing.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
             if (existing.status === 'pending') return res.status(400).json({ error: 'Friend request already pending' });
         }
         const { error: insertError } = await supabaseAdmin.from('friendships').insert({ user_id_1: user1, user_id_2: user2, status: 'pending', action_user_id: requesterId });
         if (insertError) throw insertError;
         res.status(201).json({ message: 'Friend request sent' });
     } catch (err) {
         console.error('Error sending friend request:', err.message);
         res.status(500).json({ error: 'Failed to send friend request' });
     }
 });

 // POST /api/friends/accept - Accept a friend request (No changes needed here)
 friendsRouter.post('/accept', async (req, res) => {
     const recipientId = req.user.id; // The logged-in user accepting the request
     const requesterId = req.body.requesterId; // The ID of the user who sent the request
     if (!requesterId) return res.status(400).json({ error: 'Requester ID is required' });
     try {
         const [user1, user2] = [requesterId, recipientId].sort();
         const { data: request, error: findError } = await supabaseAdmin
             .from('friendships')
             .select('id, status, action_user_id')
              .or(`and(user_id_1.eq.${user1},user_id_2.eq.${user2}),and(user_id_1.eq.${user2},user_id_2.eq.${user1})`)
             .single();
         if (findError || !request) throw new Error('Friend request not found or invalid.');
         if (request.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });
         if (request.action_user_id === recipientId) return res.status(403).json({ error: 'Cannot accept your own request' });
         const { error: updateError } = await supabaseAdmin
             .from('friendships')
             .update({ status: 'accepted', action_user_id: recipientId, updated_at: new Date().toISOString() })
             .eq('id', request.id);
         if (updateError) throw updateError;
         res.status(200).json({ message: 'Friend request accepted' });
     } catch (err) {
         console.error('Error accepting friend request:', err.message);
          if (err.message.includes('Friend request not found')) return res.status(404).json({ error: err.message });
         res.status(500).json({ error: 'Failed to accept friend request' });
     }
 });

  // GET /api/friends - List accepted friends for the logged-in user (Corrected with explicit FK names)
 friendsRouter.get('/', async (req, res) => {
     const userId = req.user.id; // ID of the logged-in user
     try {
         // *** ASSUMES default FK names. Verify yours in Supabase UI! ***
         const fk1_name = 'friendships_user_id_1_fkey'; // Constraint linking user_id_1 to profiles.id
         const fk2_name = 'friendships_user_id_2_fkey'; // Constraint linking user_id_2 to profiles.id

         const { data, error } = await supabaseAdmin
             .from('friendships')
             // Select friendship details and join with profiles using explicit FK names
             .select(`
                 id,
                 status,
                 user_id_1,
                 user_id_2,
                 profile1: profiles!${fk1_name}(id, username),
                 profile2: profiles!${fk2_name}(id, username)
             `)
             .eq('status', 'accepted') // Filter for accepted friendships only
             .or(`user_id_1.eq.${userId},user_id_2.eq.${userId}`); // Where the current user is one of the participants


         if (error) throw error; // Propagate database errors

         // Process the results to create a clean list of friend profiles
         const friends = data.map(f => {
             // Identify which profile belongs to the friend (not the current user)
             const friendProfile = f.profile1 && f.profile1.id === userId ? f.profile2 : f.profile1;
              // Handle cases where a profile might be missing
             if (!friendProfile) return null;
             // Return only the necessary friend information
             return {
                 friendship_id: f.id, // ID of the friendship record itself
                 id: friendProfile.id, // Friend's user ID
                 username: friendProfile.username // Friend's username
             };
         }).filter(friend => friend !== null && friend.id); // Filter out any null entries

         // Respond with the list of friends
         res.status(200).json(friends);

     } catch (err) {
         console.error('Error fetching friends:', err.message);
         res.status(500).json({ error: 'Failed to fetch friends' });
     }
 });


 // GET /api/friends/pending - List incoming pending friend requests for the logged-in user (Corrected with explicit FK name)
 friendsRouter.get('/pending', async (req, res) => {
     const userId = req.user.id; // ID of the logged-in user
     try {
         // *** ASSUMES default FK name. Verify yours in Supabase UI! ***
         const action_user_fk_name = 'friendships_action_user_id_fkey'; // Constraint linking action_user_id to profiles.id

         const { data, error } = await supabaseAdmin
             .from('friendships')
              // Select friendship ID and join with profiles using explicit FK name
              .select(`
                 id,
                 action_user_id,
                 requester: profiles!${action_user_fk_name} (id, username)
              `)
             .eq('status', 'pending') // Filter for pending requests only
             .or(`user_id_1.eq.${userId},user_id_2.eq.${userId}`) // Where the current user is involved
             .neq('action_user_id', userId); // But the current user did NOT send the request


         if (error) throw error; // Propagate database errors

         // Process results to create a list of requesters
         const pendingRequests = data.map(f => {
              // Handle cases where requester profile might be missing
              if (!f.requester) return null;
              // Return relevant info about the pending request
              return {
                 friendship_id: f.id, // ID of the friendship record
                 requester_id: f.requester.id, // ID of the user who sent the request
                 requester_username: f.requester.username // Username of the requester
              };
         }).filter(req => req !== null && req.requester_id); // Filter out null entries

         // Respond with the list of pending requests
         res.status(200).json(pendingRequests);

     } catch (err) {
         console.error('Error fetching pending requests:', err.message);
         res.status(500).json({ error: 'Failed to fetch pending requests' });
     }
 });


 // Mount the friends router under the /api/friends prefix
 // Ensure this line exists AFTER the route definitions within friendsRouter
 app.use('/api/friends', friendsRouter);
 // --- End Friends Routes ---




// --- Conversations and Messages Routes ---
const conversationRouter = express.Router();
conversationRouter.use(authenticateUser); // Protect all conversation routes

// GET /api/conversations - List conversations for the logged-in user (Corrected v2)
conversationRouter.get('/', async (req, res) => {
    const userId = req.user.id;
    try {
        // 1. Find all conversation IDs the user is part of
        const { data: userConvoIds, error: idError } = await supabaseAdmin
            .from('conversation_participants')
            .select('conversation_id')
            .eq('user_id', userId);

        if (idError) throw idError;
        if (!userConvoIds || userConvoIds.length === 0) {
            // User has no conversations yet
            return res.status(200).json([]);
        }

        const conversationIds = userConvoIds.map(c => c.conversation_id);

        // 2. Fetch details for these conversations, including all participants and their profiles
        const { data: conversationsData, error: convosError } = await supabaseAdmin
            .from('conversations')
            .select(`
                id,
                created_at,
                last_message_at,
                participants: conversation_participants!inner (
                    user_id,
                    profile: profiles!inner ( id, username )
                )
            `)
            .in('id', conversationIds); // Filter by the user's conversations

        if (convosError) throw convosError;


        // 3. Process the data to format for the frontend
        const conversations = conversationsData.map(convo => {
            // Find the other participant(s) in the conversation
            const otherParticipants = convo.participants
                .filter(p => p.user_id !== userId && p.profile) // Exclude self, ensure profile exists
                .map(p => p.profile); // Get just the profile info

            // If for some reason other participants aren't found (e.g., data issue), skip
            if (otherParticipants.length === 0) {
                return null;
            }

            return {
                id: convo.id,
                created_at: convo.created_at,
                last_message_at: convo.last_message_at,
                // Assuming 1-on-1 chats for now
                other_participant: otherParticipants[0]
            };
        }).filter(c => c !== null); // Filter out any null entries


        res.status(200).json(conversations);

    } catch (err) {
        console.error('Error fetching conversations:', err.message);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});


// POST /api/conversations/findOrCreate - Find or create a 1-on-1 conversation
conversationRouter.post('/findOrCreate', async (req, res) => {
    const userId1 = req.user.id; // Current user ID
    const userId2 = req.body.otherUserId; // Target user ID from request body

    // Validation
    if (!userId2) return res.status(400).json({ error: 'Other user ID is required' });
    if (userId1 === userId2) return res.status(400).json({ error: 'Cannot create conversation with yourself' });

    try {
        // Use a database function (or complex query) to efficiently find existing 1-on-1 convos
        // RPC (Remote Procedure Call) is often the best way for this in Supabase/Postgres
        const { data: existingConvo, error: rpcError } = await supabaseAdmin.rpc('find_or_create_conversation', {
            p_user_id_1: userId1,
            p_user_id_2: userId2
        });

        // Handle potential errors from the database function call
        if (rpcError) throw rpcError;

        // Check if the function returned a valid conversation ID
        if (existingConvo && existingConvo.length > 0 && existingConvo[0].conversation_id) {
             // The structure might vary based on your function, adjust access accordingly
             const convoId = existingConvo[0].conversation_id;
             const created = existingConvo[0].created; // Assuming the function returns this flag
             console.log(`Conversation ${created ? 'created' : 'found'}: ${convoId}`);
             res.status(created ? 201 : 200).json({ conversation_id: convoId, created: created });
        } else {
            // If the RPC didn't return expected data, throw an error
             throw new Error('Failed to find or create conversation using RPC.');
        }

        // *** Note: The complex query logic previously here is replaced by the RPC call. ***
        // *** You MUST create the 'find_or_create_conversation' function in Supabase SQL Editor. ***
        /* Example SQL Function (Create in Supabase SQL Editor):
           CREATE OR REPLACE FUNCTION find_or_create_conversation(p_user_id_1 uuid, p_user_id_2 uuid)
           RETURNS TABLE(conversation_id uuid, created boolean) AS $$
           DECLARE
               v_conversation_id uuid;
               v_created boolean := false;
               v_user_1 uuid := p_user_id_1;
               v_user_2 uuid := p_user_id_2;
           BEGIN
               -- Ensure consistent user order
               IF v_user_1 > v_user_2 THEN
                   SELECT v_user_1, v_user_2 INTO v_user_2, v_user_1;
               END IF;

               -- Check if a 1-on-1 conversation already exists
               SELECT cp1.conversation_id INTO v_conversation_id
               FROM conversation_participants cp1
               JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
               WHERE cp1.user_id = v_user_1 AND cp2.user_id = v_user_2
               AND NOT EXISTS ( -- Ensure it's ONLY these two participants
                   SELECT 1 FROM conversation_participants cp3
                   WHERE cp3.conversation_id = cp1.conversation_id
                   AND cp3.user_id NOT IN (v_user_1, v_user_2)
               )
               LIMIT 1;

               -- If not found, create it
               IF v_conversation_id IS NULL THEN
                   v_created := true;
                   -- Create the conversation
                   INSERT INTO public.conversations DEFAULT VALUES RETURNING id INTO v_conversation_id;
                   -- Add participants
                   INSERT INTO public.conversation_participants (conversation_id, user_id)
                   VALUES (v_conversation_id, v_user_1), (v_conversation_id, v_user_2);
               END IF;

               -- Return the result
               RETURN QUERY SELECT v_conversation_id, v_created;
           END;
           $$ LANGUAGE plpgsql SECURITY DEFINER; -- Use SECURITY DEFINER if needed based on RLS
        */

    } catch (err) {
        console.error('Error finding or creating conversation:', err.message);
        res.status(500).json({ error: 'Failed to find or create conversation' });
    }
});


// GET /api/conversations/:conversationId/messages - List messages in a specific conversation
conversationRouter.get('/:conversationId/messages', async (req, res) => {
    const userId = req.user.id; // Logged-in user ID
    const conversationId = req.params.conversationId; // Target conversation ID from URL
    const limit = parseInt(req.query.limit) || 50; // Number of messages to fetch (default 50)
    const before = req.query.before; // Timestamp cursor for pagination

    try {
        // 1. Verify the user is actually a participant in this conversation
        const { count, error: checkError } = await supabaseAdmin
            .from('conversation_participants')
            .select('*', { count: 'exact', head: true }) // Efficiently check existence
            .eq('conversation_id', conversationId)
            .eq('user_id', userId);

        if (checkError) throw checkError;
        if (count === 0) {
            // If user is not a participant, deny access
            return res.status(403).json({ error: 'Forbidden: You are not part of this conversation' });
        }

        // 2. Build the query to fetch messages
        let query = supabaseAdmin
            .from('messages')
            // Select message details and join with profiles to get sender's username
            .select(`
                id,
                content,
                created_at,
                sender_id,
                sender:profiles (username)
            `)
            .eq('conversation_id', conversationId) // Filter by the target conversation
            .order('created_at', { ascending: false }) // Get newest messages first for pagination logic
            .limit(limit); // Apply the limit

        // Apply cursor-based pagination if 'before' timestamp is provided
        if (before) {
            // Fetch messages created *before* the specified timestamp
            query = query.lt('created_at', before);
        }

        // Execute the query
        const { data: messages, error: messagesError } = await query;

        if (messagesError) throw messagesError;

        // Reverse the array back to chronological order (oldest first) for frontend display
        res.status(200).json(messages.reverse());

    } catch (err) {
        console.error(`Error fetching messages for conversation ${conversationId}:`, err.message);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});


// POST /api/conversations/:conversationId/messages - Send a new message
conversationRouter.post('/:conversationId/messages', async (req, res) => {
    const userId = req.user.id; // Sender ID from authenticated user
    const conversationId = req.params.conversationId; // Target conversation ID from URL
    const { content } = req.body; // Message content from request body

    // Validate message content
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Message content cannot be empty' });
    }

    try {
         // 1. Verify the user is a participant in this conversation before allowing them to send
         const { count, error: checkError } = await supabaseAdmin
            .from('conversation_participants')
            .select('*', { count: 'exact', head: true }) // Efficient check
            .eq('conversation_id', conversationId)
            .eq('user_id', userId);

        if (checkError) throw checkError;
        if (count === 0) {
            return res.status(403).json({ error: 'Forbidden: You cannot send messages to this conversation' });
        }

        // 2. Insert the new message into the database
        const { data: newMessage, error: insertError } = await supabaseAdmin
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: userId,
                content: content.trim() // Store trimmed content
            })
            // Select the newly created message along with sender info for the response
            .select(`
                id,
                content,
                created_at,
                sender_id,
                sender:profiles (username)
            `)
            .single(); // Expect exactly one row to be inserted and returned

        if (insertError) throw insertError;

        // 3. (Optional but recommended) Update the conversation's 'last_message_at' timestamp
        // This helps in sorting conversations by recent activity. Run asynchronously (no await).
         supabaseAdmin
            .from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', conversationId)
            .then(({ error }) => {
                if (error) console.error("Error updating last_message_at:", error.message);
            });


        // Supabase Realtime (if enabled on 'messages' table) will broadcast this insert.
        // Return the newly created message object to the sender.
        res.status(201).json(newMessage);

    } catch (err) {
        console.error(`Error sending message to conversation ${conversationId}:`, err.message);
        res.status(500).json({ error: 'Failed to send message' });
    }
});


// Mount the conversation router under the /api/conversations prefix
app.use('/api/conversations', conversationRouter);
// --- End Conversations and Messages Routes ---


// --- Translation Route ---
// Moved from frontend - requires authentication
const translationRouter = express.Router();
translationRouter.use(authenticateUser); // Protect this route

translationRouter.post('/', async (req, res) => {
    // Note: We might not need the user ID here unless we implement per-user limits/logging
    // const userId = req.user.id;
    const { text, sourceLangName, targetLangName } = req.body;

    if (!text || !sourceLangName || !targetLangName) {
        return res.status(400).json({ error: 'Missing required fields: text, sourceLangName, targetLangName' });
    }

    // IMPORTANT: Add your OpenAI API Key securely from environment variables
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
        console.error("Missing OPENAI_API_KEY environment variable!");
        return res.status(500).json({ error: 'Translation service configuration error.' });
    }
    // Use environment variable for model or default
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // Default to gpt-4o-mini if not set

    // Re-use the prompt structure from your original script.js
    const prompt = `Translate the user text message by keeping any ${sourceLangName} text unchanged and translating any ${sourceLangName} text into ${targetLangName}, maintaining a 1:1 translation ratio. Ensure the tone and meaning are perfectly transferred. Maintain punctuation exactly as it appears in the original message; do not add any, including after abbreviations, if it's not in the original. Preserve any original spelling mistakes, punctuation, abbreviations, slang, and other informal expressions in the translation. The translated text should sound natural to a native speaker. Never correct mistakes in the user message.

# Output Format
Provide a final text that mirrors the original in tone, meaning, spelling mistakes, punctuation, abbreviation usage, and slang, with all ${sourceLangName} maintained and ${targetLangName} translated to ${targetLangName} in a 1:1 translation, while ensuring the translated text sounds natural to a native ${targetLangName} speaker.

# Notes
- Ensure to maintain any placeholders like @@PLACEHOLDER_X@@ exactly as they appear in the original message.
- Abbreviations and slang should be maintained as in the original without added punctuation.
- Ensure that no additional punctuation is added to the translation if it isn't present in the original message.
- These are text messages, so maintain features typical of text messages, such as informal language and brevity but don't force it.
- Unless it happens in the text, do not mix languages.
- Do not forget to translate the text.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: text } // The text to be translated
                ],
                temperature: 0.1,
                max_tokens: 1024
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("OpenAI API Error Response:", data);
            const errorMsg = data.error?.message ? `Translation Error: ${data.error.message}` : `Translation failed (status ${response.status})`;
            // Don't throw here, return error response to client
            return res.status(response.status || 500).json({ error: errorMsg });
        }

        const translatedText = (data.choices?.[0]?.message?.content || text).trim(); // Fallback to original text on error
        res.status(200).json({ translated_text: translatedText });

    } catch (error) {
        console.error("Error calling OpenAI API:", error);
        res.status(500).json({ error: 'Failed to communicate with translation service.' });
    }
});

// Mount the translation router under /api/translate
app.use('/api/translate', translationRouter);
// --- End Translation Route ---


// --- Global Error Handling Middleware ---
// This should be the LAST middleware added
app.use((err, req, res, next) => {
    // Log the error internally
    console.error("Unhandled Error:", err.stack || err);

    // Respond with a generic error message
    // Avoid sending detailed stack traces to the client in production
    res.status(err.status || 500).json({ error: err.message || 'An unexpected error occurred on the server.' });
});
// --- End Error Handling ---


// --- Start Server ---
// Make the Express app listen on the defined port
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Access API at http://localhost:${PORT}`); // Helpful log message
});
// --- End Start Server 