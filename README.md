# Translo

A real-time chat application with AI-powered translation capabilities. Connect with friends, chat in real-time, and translate messages between languages using OpenAI's GPT.

## Features

- **User Authentication** - Secure signup and login with JWT tokens
- **Friend System** - Search users, send/accept friend requests
- **Real-time Messaging** - Instant message delivery via Supabase Realtime
- **AI Translation** - Translate messages between languages using OpenAI GPT-4o-mini
- **Responsive UI** - iOS-inspired design that works on mobile and desktop

## Tech Stack

**Frontend**
- HTML5, CSS3, Vanilla JavaScript
- Supabase Client (real-time subscriptions)

**Backend**
- Node.js with Express.js
- Supabase (PostgreSQL database + authentication)
- OpenAI API (translations)

## Project Structure

```
translo-app/
├── backend/
│   ├── index.js          # Express server with all API routes
│   ├── package.json      # Backend dependencies
│   └── .env              # Environment variables
└── frontend/
    ├── index.html        # Main HTML page
    ├── script.js         # Frontend logic
    └── style.css         # Styling
```

## Getting Started

### Prerequisites

- Node.js (v16+)
- Supabase account
- OpenAI API key

### Database Setup

Create the following tables in your Supabase project:

```sql
-- profiles table
create table profiles (
  id uuid references auth.users primary key,
  username text unique not null
);

-- friendships table
create table friendships (
  id uuid default gen_random_uuid() primary key,
  user_id_1 uuid references profiles(id) not null,
  user_id_2 uuid references profiles(id) not null,
  status text not null default 'pending',
  action_user_id uuid references profiles(id) not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- conversations table
create table conversations (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  last_message_at timestamp with time zone
);

-- conversation_participants table
create table conversation_participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

-- messages table
create table messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id uuid references profiles(id) not null,
  content text not null,
  created_at timestamp with time zone default now()
);
```

Create the RPC function for finding or creating conversations:

```sql
create or replace function find_or_create_conversation(p_user_id_1 uuid, p_user_id_2 uuid)
returns table(conversation_id uuid, created boolean)
language plpgsql
as $$
declare
  v_conversation_id uuid;
  v_created boolean := false;
begin
  -- Find existing conversation
  select cp1.conversation_id into v_conversation_id
  from conversation_participants cp1
  join conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = p_user_id_1 and cp2.user_id = p_user_id_2;

  -- Create if not found
  if v_conversation_id is null then
    insert into conversations default values returning id into v_conversation_id;
    insert into conversation_participants (conversation_id, user_id) values
      (v_conversation_id, p_user_id_1),
      (v_conversation_id, p_user_id_2);
    v_created := true;
  end if;

  return query select v_conversation_id, v_created;
end;
$$;
```

### Environment Variables

Create `backend/.env`:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/translo-app.git
   cd translo-app
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

3. Start the backend server:
   ```bash
   npm run dev
   ```

4. Open `frontend/index.html` in your browser or serve it with a local server.

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register a new user |
| POST | `/api/auth/login` | Login and get JWT token |

### Users (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/search?query=` | Search users by username |

### Friends (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/friends` | List accepted friends |
| GET | `/api/friends/pending` | List pending friend requests |
| POST | `/api/friends/request` | Send friend request |
| POST | `/api/friends/accept` | Accept friend request |

### Conversations (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations` | List all conversations |
| POST | `/api/conversations/findOrCreate` | Find or create a conversation |
| GET | `/api/conversations/:id/messages` | Get messages (paginated) |
| POST | `/api/conversations/:id/messages` | Send a message |

### Translation (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/translate` | Translate text between languages |

## Real-time Features

The app uses Supabase Realtime to provide:
- Instant message delivery when chatting
- Live updates to friend lists and pending requests

## License

MIT
