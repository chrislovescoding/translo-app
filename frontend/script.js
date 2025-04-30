// frontend/script.js

// --- Configuration ---
// IMPORTANT: Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://mpvywxbrypssqklitdgn.supabase.co'; // Replace! Find in Supabase Project Settings > API
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wdnl3eGJyeXBzc3FrbGl0ZGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5NjgxODIsImV4cCI6MjA2MTU0NDE4Mn0.DG-v-7wVg2q4IrAuNqifcUU8FJvv-HHBA58eQHvsHdU'; // Replace! Find in Supabase Project Settings > API
const API_BASE_URL = 'http://localhost:3000/api'; // Your backend API URL
// frontend/script.js

// --- Supabase Client Initialization ---
let supabase = null; // Initialize variable to hold the client instance
try {
    if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
        throw new Error("Supabase URL is not configured.");
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
        throw new Error("Supabase Anon Key is not configured.");
    }
    // Corrected line: Explicitly use window.supabase
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase client initialized.");
} catch (error) {
    console.error("Error initializing Supabase:", error);
    // Display error to the user
    alert(`Failed to initialize Supabase: ${error.message}\nPlease check configuration in script.js`);
}


// --- State Variables ---
let currentUser = null; // Stores logged-in user info { id, email, username }
let currentToken = null; // Stores the JWT access token
let friends = []; // Stores friend list [{ id, username, friendship_id }]
let pendingRequests = []; // Stores incoming pending requests [{ friendship_id, requester_id, requester_username }]
let searchResults = []; // Stores user search results [{ id, username }]
let currentChat = { // Info about the currently active chat
    conversationId: null,
    otherParticipant: null // { id, username }
};
let messages = []; // Stores messages for the current chat
let messageSubscription = null; // Holds the Supabase Realtime subscription object for messages
let friendshipSubscription = null; // Holds the Supabase Realtime subscription object for friendships

// --- DOM Element References ---
// Auth Elements
const authContainer = document.getElementById('auth-container');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginButton = document.getElementById('login-button');
const loginErrorEl = document.getElementById('login-error');
const signupUsernameInput = document.getElementById('signup-username');
const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');
const signupButton = document.getElementById('signup-button');
const signupErrorEl = document.getElementById('signup-error');
const showSignupLink = document.getElementById('show-signup');
const showLoginLink = document.getElementById('show-login');

// App Elements
const appContainer = document.getElementById('app-container');
const logoutButton = document.getElementById('logout-button');

// Sidebar Elements
const userSearchInput = document.getElementById('user-search-input');
const userSearchButton = document.getElementById('user-search-button');
const searchResultsList = document.getElementById('search-results-list');
const friendList = document.getElementById('friend-list');
const pendingRequestsList = document.getElementById('pending-requests-list');

// Chat Elements
const chatHeaderUsername = document.getElementById('chat-with-username');
const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');


// --- API Helper Function ---
/**
 * Makes an authenticated request to the backend API.
 * Handles adding the Authorization header and parsing JSON response.
 * @param {string} endpoint - API endpoint path (e.g., '/users/search')
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {object} [body=null] - Request body for POST/PUT requests
 * @returns {Promise<object>} - The JSON response data
 * @throws {Error} - Throws an error if the request fails or returns an error status
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const options = {
        method: method,
        headers: headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        let responseData;
        try {
             responseData = await response.json();
        } catch (jsonError) {
            // If JSON parsing fails (e.g., empty response), create a basic error object
            responseData = { error: await response.text() || `HTTP error! status: ${response.status}` };
        }
        if (!response.ok) {
            // Use the error message from the parsed JSON if available
            throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
        }
        return responseData; // Return parsed data on success
    } catch (error) {
        console.error(`API request failed: ${method} ${endpoint}`, error);
        // Re-throw the error so the calling function can handle it (e.g., display to user)
        throw error;
    }
}

// --- Authentication Functions ---
async function handleLogin(event) {
    console.log("handleLogin triggered!");
    // Prevent default form submission if called from a form's submit event
    if(event) event.preventDefault();
    clearErrorMessages();
    // Disable button to prevent multiple clicks
    loginButton.disabled = true;
    loginButton.textContent = 'Logging in...';
    const email = loginEmailInput.value;
    const password = loginPasswordInput.value;
    try {
        // Call the backend login endpoint
        const data = await apiRequest('/auth/login', 'POST', { email, password });
        console.log('Login successful:', data);
        // Store the received token and user info
        currentToken = data.access_token;
        currentUser = data.user;
        // Persist session in localStorage
        localStorage.setItem('authToken', currentToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        // Initialize the main application view
        await initializeApp();
    } catch (error) {
        // Display login errors to the user
        console.error('Login failed:', error);
        loginErrorEl.textContent = error.message || 'Login failed. Please try again.';
        // Re-enable the button on failure
        loginButton.disabled = false;
        loginButton.textContent = 'Login';
    }
}

async function handleSignup(event) {
    console.log("handleSignup triggered!");
     // Prevent default form submission if called from a form's submit event
    if(event) event.preventDefault();
    clearErrorMessages();
    signupButton.disabled = true;
    signupButton.textContent = 'Signing up...';
    const username = signupUsernameInput.value;
    const email = signupEmailInput.value;
    const password = signupPasswordInput.value;
    try {
        // Call the backend signup endpoint
        const data = await apiRequest('/auth/signup', 'POST', { username, email, password });
        console.log('Signup successful:', data);
        // Show success message and switch to login form
        alert(data.message || 'Signup successful! You can now log in.');
        showLoginForm();
        // Clear the signup form fields
        signupUsernameInput.value = '';
        signupEmailInput.value = '';
        signupPasswordInput.value = '';
    } catch (error) {
        // Display signup errors
        console.error('Signup failed:', error);
        signupErrorEl.textContent = error.message || 'Signup failed. Please try again.';
    } finally {
        // Always re-enable the signup button
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
    }
}

function handleLogout() {
    console.log('Logging out...');
    // Clear all application state variables
    currentUser = null;
    currentToken = null;
    friends = [];
    pendingRequests = [];
    searchResults = [];
    currentChat = { conversationId: null, otherParticipant: null };
    messages = [];
    // Clear session data from localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    // Disconnect from any active realtime subscriptions
    unsubscribeFromMessages();
    unsubscribeFromFriendships(); // *** Added ***
    // Show the login/signup UI
    showAuthUI();
    // Clear dynamic UI lists
    clearAllLists();
    // Reset chat area UI elements
    messagesArea.innerHTML = '';
    chatHeaderUsername.textContent = 'Select a friend to chat';
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
}

function checkSession() {
    console.log('Checking for existing session...');
    // Retrieve token and user data from localStorage
    const storedToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('currentUser');

    // If both exist, attempt to restore the session
    if (storedToken && storedUser) {
        console.log('Found existing session.');
        currentToken = storedToken;
        try {
            // Parse stored user data
            currentUser = JSON.parse(storedUser);
            // Validate parsed data
            if (currentUser && currentUser.id) {
                 initializeApp(); // Initialize the app with restored session
                 return; // Stop further execution in this function
            } else {
                // If data is invalid, treat as logged out
                throw new Error("Stored user data is invalid.");
            }
        } catch (error) {
             // If parsing fails or data is invalid, clear storage and log out
             console.error("Error parsing stored user data:", error);
             handleLogout(); // This will clear storage and show auth UI
        }
    } else {
        // If no session data found, show the login/signup UI
        console.log('No active session found.');
        showAuthUI();
    }
}

// --- UI Toggling Functions ---
function showAuthUI() {
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
}

function showAppUI() {
    authContainer.style.display = 'none';
    appContainer.style.display = 'flex'; // Use flex to show sidebar and chat side-by-side
}

function showLoginForm() {
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    clearErrorMessages(); // Clear errors when switching forms
}

function showSignupForm() {
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    clearErrorMessages(); // Clear errors when switching forms
}

function clearErrorMessages() {
    loginErrorEl.textContent = '';
    signupErrorEl.textContent = '';
}

// --- Data Fetching and Rendering ---
// Initializes the main app view after login or session restoration
async function initializeApp() {
    console.log('Initializing app data...');
    showAppUI(); // Display the main app container
    // Fetch initial data needed for the app view
    await fetchFriends();
    await fetchPendingRequests();
    // Messages are fetched when a specific chat is selected

    // *** Subscribe to friendship changes ***
    subscribeToFriendships();
}

// Fetches the user's friend list from the backend
async function fetchFriends() {
    // No changes needed in this function itself
    try {
        console.log('Fetching friends...');
        friends = await apiRequest('/friends', 'GET');
        console.log('Friends fetched:', friends);
        renderFriendList(); // Update the UI
    } catch (error) {
        console.error('Error fetching friends:', error);
        alert(`Error fetching friends: ${error.message}`);
        // If unauthorized (e.g., token expired), log the user out
        if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Fetches incoming pending friend requests
async function fetchPendingRequests() {
    // No changes needed in this function itself
    try {
        console.log('Fetching pending requests...');
        pendingRequests = await apiRequest('/friends/pending', 'GET');
        console.log('Pending requests fetched:', pendingRequests);
        renderPendingRequests(); // Update the UI
    } catch (error) {
        console.error('Error fetching pending requests:', error);
        alert(`Error fetching pending requests: ${error.message}`);
        if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Fetches messages for a specific conversation and subscribes to realtime updates
async function fetchMessages(conversationId) {
    // No changes needed in this function itself
    if (!conversationId) return;
    console.log(`Fetching messages for conversation: ${conversationId}`);
    try {
        messages = await apiRequest(`/conversations/${conversationId}/messages?limit=50`, 'GET');
        console.log(`Messages fetched for ${conversationId}:`, messages);
        renderMessages();
        subscribeToMessages(conversationId);
    } catch (error) {
        console.error(`Error fetching messages for ${conversationId}:`, error);
        alert(`Error fetching messages: ${error.message}`);
        if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Renders the friend list in the sidebar
function renderFriendList() {
    // No changes needed in this function itself
    friendList.innerHTML = '';
    if (!friends || friends.length === 0) {
        friendList.innerHTML = '<li>No friends yet. Search users to add friends.</li>';
        return;
    }
    friends.forEach(friend => {
        const li = document.createElement('li');
        li.textContent = friend.username || `User ${friend.id.substring(0, 6)}`;
        li.dataset.friendId = friend.id;
        li.dataset.username = friend.username;
        li.addEventListener('click', handleFriendClick);
        friendList.appendChild(li);
    });
}

// Renders the pending friend request list in the sidebar
function renderPendingRequests() {
    // No changes needed in this function itself
    pendingRequestsList.innerHTML = '';
    if (!pendingRequests || pendingRequests.length === 0) {
        pendingRequestsList.innerHTML = '<li>No pending requests.</li>';
        return;
    }
    pendingRequests.forEach(req => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = req.requester_username || `User ${req.requester_id.substring(0, 6)}`;
        li.appendChild(span);
        const acceptButton = document.createElement('button');
        acceptButton.textContent = 'Accept';
        acceptButton.classList.add('accept-request-btn');
        acceptButton.dataset.requesterId = req.requester_id;
        acceptButton.addEventListener('click', handleAcceptRequest);
        li.appendChild(acceptButton);
        pendingRequestsList.appendChild(li);
    });
}

// Renders the user search results in the sidebar
function renderSearchResults() {
    // No changes needed in this function itself
    searchResultsList.innerHTML = '';
    if (!searchResults || searchResults.length === 0) {
        searchResultsList.innerHTML = '<li>No users found matching your query.</li>';
        return;
    }
    searchResults.forEach(user => {
        const isFriend = friends.some(f => f.id === user.id);
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = user.username || `User ${user.id.substring(0, 6)}`;
        li.appendChild(span);
        if (!isFriend) {
            const addButton = document.createElement('button');
            addButton.textContent = 'Add';
            addButton.classList.add('add-friend-btn');
            addButton.dataset.recipientId = user.id;
            addButton.addEventListener('click', handleAddFriend);
            li.appendChild(addButton);
        } else {
             const friendStatus = document.createElement('span');
             friendStatus.textContent = ' (Friend)';
             friendStatus.style.fontSize = '0.8em';
             friendStatus.style.color = '#6c757d';
             li.appendChild(friendStatus);
        }
        searchResultsList.appendChild(li);
    });
}

// Renders all messages currently stored in the `messages` state variable
function renderMessages() {
    // No changes needed in this function itself
    messagesArea.innerHTML = '';
    messages.forEach(msg => {
        appendMessageBubble(msg);
    });
    scrollToBottom(messagesArea);
}

// Appends a single message bubble to the chat area
function appendMessageBubble(msg) {
    // No changes needed in this function itself
    const isOptimistic = msg.id?.toString().startsWith('temp-');
    const isOutgoing = msg.sender_id === currentUser.id;
    const bubble = document.createElement('div');
    bubble.classList.add('bubble');
    bubble.classList.add(isOutgoing ? 'outgoing' : 'incoming');
    if (isOptimistic) bubble.id = msg.id;
    if (!isOutgoing && msg.sender?.username) {
        const nameDiv = document.createElement('div');
        nameDiv.className = 'sender_name';
        nameDiv.textContent = msg.sender.username;
        bubble.appendChild(nameDiv);
    }
    const span = document.createElement('span');
    span.textContent = msg.content;
    bubble.appendChild(span);
    messagesArea.appendChild(bubble);
    if (!isOptimistic) {
        requestAnimationFrame(() => {
            bubble.style.opacity = 1;
            bubble.style.transform = 'translateY(0)';
        });
    } else {
         bubble.style.opacity = 1;
         bubble.style.transform = 'translateY(0)';
    }
}

// Clears all dynamic lists in the sidebar
function clearAllLists() {
    // No changes needed in this function itself
    friendList.innerHTML = '';
    pendingRequestsList.innerHTML = '';
    searchResultsList.innerHTML = '';
}

// Utility function to scroll an element to its bottom
function scrollToBottom(element) {
    // No changes needed in this function itself
    if (element) {
        element.scrollTop = element.scrollHeight;
    }
}

// --- Event Handlers ---
// Handles clicking on a friend in the list to start a chat
async function handleFriendClick(event) {
    // No changes needed in this function itself
    const friendId = event.currentTarget.dataset.friendId;
    const username = event.currentTarget.dataset.username;
    if (!friendId || !username) return;
    console.log(`Clicked friend: ${username} (${friendId})`);
    chatHeaderUsername.textContent = `Chat with ${username}`;
    messageInput.disabled = true;
    sendButton.disabled = true;
    messagesArea.innerHTML = '<li>Loading chat...</li>';
    try {
        const convoData = await apiRequest('/conversations/findOrCreate', 'POST', { otherUserId: friendId });
        currentChat.conversationId = convoData.conversation_id;
        currentChat.otherParticipant = { id: friendId, username: username };
        console.log(`Conversation ID set: ${currentChat.conversationId}`);
        await fetchMessages(currentChat.conversationId);
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    } catch (error) {
        console.error('Error starting chat:', error);
        alert(`Could not start chat: ${error.message}`);
        chatHeaderUsername.textContent = 'Select a friend to chat';
        messagesArea.innerHTML = '<li>Error loading chat.</li>';
         if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Handles clicking the 'Accept' button on a pending request
async function handleAcceptRequest(event) {
    // No changes needed in this function itself
    event.stopPropagation();
    const button = event.currentTarget;
    const requesterId = button.dataset.requesterId;
    if (!requesterId) return;
    button.disabled = true;
    button.textContent = 'Accepting...';
    try {
        await apiRequest('/friends/accept', 'POST', { requesterId: requesterId });
        alert('Friend request accepted!');
        await fetchFriends();
        await fetchPendingRequests();
    } catch (error) {
        console.error('Error accepting request:', error);
        alert(`Could not accept request: ${error.message}`);
        button.disabled = false;
        button.textContent = 'Accept';
        if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Handles clicking the 'Add' button on a user search result
async function handleAddFriend(event) {
    // No changes needed in this function itself
    event.stopPropagation();
    const button = event.currentTarget;
    const recipientId = button.dataset.recipientId;
    if (!recipientId) return;
    button.disabled = true;
    button.textContent = 'Adding...';
    try {
        await apiRequest('/friends/request', 'POST', { recipientId: recipientId });
        alert('Friend request sent!');
        button.textContent = 'Pending';
    } catch (error) {
        console.error('Error sending request:', error);
        alert(`Could not send request: ${error.message}`);
        button.disabled = false;
        button.textContent = 'Add';
        if (error.message.includes("Unauthorized")) handleLogout();
    }
}

// Handles searching for users via the sidebar input
async function handleSearchUsers() {
    // No changes needed in this function itself
    const query = userSearchInput.value.trim();
    if (query.length < 2) {
        searchResultsList.innerHTML = '<li>Enter at least 2 characters.</li>';
        return;
    }
    searchResultsList.innerHTML = '<li>Searching...</li>';
    userSearchButton.disabled = true;
    try {
        searchResults = await apiRequest(`/users/search?query=${encodeURIComponent(query)}`, 'GET');
        renderSearchResults();
    } catch (error) {
        console.error('Error searching users:', error);
        searchResultsList.innerHTML = `<li>Error: ${error.message}</li>`;
        if (error.message.includes("Unauthorized")) handleLogout();
    } finally {
        userSearchButton.disabled = false;
    }
}

// Handles sending a message from the chat input area
async function handleSendMessage() {
    // No changes needed in this function itself, but added comments on Optimistic UI
    const content = messageInput.value.trim();
    if (!content || !currentChat.conversationId) return;
    messageInput.disabled = true;
    sendButton.disabled = true;

    // --- Optimistic UI Update ---
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
        id: tempId, content: content, created_at: new Date().toISOString(),
        sender_id: currentUser.id, sender: { username: currentUser.username }
    };
    appendMessageBubble(optimisticMsg);
    scrollToBottom(messagesArea);
    messageInput.value = '';
    // --- End Optimistic UI ---

    try {
        const confirmedMsg = await apiRequest(`/conversations/${currentChat.conversationId}/messages`, 'POST', { content });
        console.log("Message sent successfully:", confirmedMsg);
        // Optional Reconciliation: Update temp message ID or rely on realtime listener
    } catch (error) {
        console.error('Error sending message:', error);
        alert(`Failed to send message: ${error.message}`);
        // --- Rollback Optimistic Update ---
        const tempMsgElement = document.getElementById(tempId);
        if (tempMsgElement) tempMsgElement.remove();
        messageInput.value = content; // Restore text
        // --- End Rollback ---
         if (error.message.includes("Unauthorized")) handleLogout();
    } finally {
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// --- Supabase Realtime Subscription ---
// Sets up a listener for new messages in a specific conversation
function subscribeToMessages(conversationId) {
    // No changes needed in this function itself
    unsubscribeFromMessages();
    if (!supabase || !conversationId) return;
    console.log(`Subscribing to messages for conversation: ${conversationId}`);
    const channel = supabase.channel(`messages_conv_${conversationId}`);

    messageSubscription = channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
            (payload) => {
                console.log('Realtime INSERT received (Messages):', payload);
                const newMessage = payload.new;
                 if (newMessage.sender_id === currentUser.id) {
                     console.log("Realtime ignoring own message.");
                     return;
                 }
                appendMessageBubble({ ...newMessage, sender: { username: currentChat.otherParticipant?.id === newMessage.sender_id ? currentChat.otherParticipant.username : 'Unknown' } });
                scrollToBottom(messagesArea);
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log(`Successfully subscribed to message channel: ${channel.channelName}`);
            } else {
                console.error(`Message subscription error/status for ${conversationId}:`, status, err);
            }
        });
}

// Unsubscribes from the current message channel
function unsubscribeFromMessages() {
    // No changes needed in this function itself
    if (messageSubscription) {
        console.log(`Unsubscribing from message channel: ${messageSubscription.channelName}`);
        supabase.removeChannel(messageSubscription)
            .then(() => console.log("Unsubscribed successfully from messages."))
            .catch(err => console.error("Error unsubscribing from messages:", err));
        messageSubscription = null;
    }
}

// *** NEW: Subscribe to friendship changes ***
function subscribeToFriendships() {
    unsubscribeFromFriendships(); // Ensure only one subscription active
    if (!supabase || !currentUser) return; // Need client and user to filter events

    console.log(`Subscribing to friendship changes for user: ${currentUser.id}`);
    const channel = supabase.channel(`friendships_user_${currentUser.id}`);

    friendshipSubscription = channel
        .on(
            'postgres_changes',
            {
                event: '*', // Listen for INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'friendships',
                // Filter for changes where the current user is either user_id_1 OR user_id_2
                // This is less precise than ideal but covers most cases simply
                filter: `user_id_1=eq.${currentUser.id},or(user_id_2=eq.${currentUser.id})` // Note: This filter might need adjustment based on exact Supabase capabilities
            },
            async (payload) => {
                console.log('Realtime change received (Friendships):', payload);
                const eventType = payload.eventType;
                const record = eventType === 'DELETE' ? payload.old : payload.new;

                // Check if the current user is actually involved in this specific record change
                if (record && (record.user_id_1 === currentUser.id || record.user_id_2 === currentUser.id)) {
                    console.log(`Friendship change relevant to user ${currentUser.id}. Event: ${eventType}`);

                    // Re-fetch friends and pending requests to update the UI
                    // This is simpler than trying to parse the payload and update lists manually
                    await fetchFriends();
                    await fetchPendingRequests();

                    // Optional: Notify user
                    // if (eventType === 'INSERT' && record.status === 'pending' && record.action_user_id !== currentUser.id) {
                    //     alert(`You have a new friend request from user ${record.action_user_id}!`); // Need username lookup here
                    // } else if (eventType === 'UPDATE' && record.status === 'accepted') {
                    //     alert(`Friend request accepted/updated!`);
                    // }
                } else {
                     console.log(`Friendship change not relevant to user ${currentUser.id}. Event: ${eventType}`);
                }
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log(`Successfully subscribed to friendship channel: ${channel.channelName}`);
            } else {
                console.error(`Friendship subscription error/status for user ${currentUser.id}:`, status, err);
            }
        });
}

// *** NEW: Unsubscribe from friendship changes ***
function unsubscribeFromFriendships() {
    if (friendshipSubscription) {
        console.log(`Unsubscribing from friendship channel: ${friendshipSubscription.channelName}`);
        supabase.removeChannel(friendshipSubscription)
            .then(() => console.log("Unsubscribed successfully from friendships."))
            .catch(err => console.error("Error unsubscribing from friendships:", err));
        friendshipSubscription = null;
    }
}


// --- Event Listeners Setup ---
// Attaches all necessary event listeners when the script loads
function addEventListeners() {
    // Use 'click' for buttons as they are not in <form> elements
    loginButton.addEventListener('click', handleLogin);
    signupButton.addEventListener('click', handleSignup);
    // Use 'click' for links to toggle forms
    showSignupLink.addEventListener('click', (e) => { e.preventDefault(); showSignupForm(); });
    showLoginLink.addEventListener('click', (e) => { e.preventDefault(); showLoginForm(); });

    // Logout button
    logoutButton.addEventListener('click', handleLogout);

    // User Search button and input (Enter key)
    userSearchButton.addEventListener('click', handleSearchUsers);
    userSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearchUsers(); });

    // Send Message button and input (Enter key)
    sendButton.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });

    // Note: Listeners for dynamic elements (friend list, search results, pending requests)
    // are added *when those elements are rendered* (e.g., inside renderFriendList).
}

// --- Initial Load ---
// Runs when the HTML document is fully parsed and loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded.');
    // Check if Supabase client initialized correctly before proceeding
    if (!supabase) {
         console.error("Supabase client not available. Aborting initialization.");
         return; // Stop execution if Supabase is not ready
    }
    // Attach all static event listeners
    addEventListeners();
    // Check if there's an existing user session in localStorage
    checkSession();
});
