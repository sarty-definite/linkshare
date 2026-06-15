# Link Share

A production-oriented real-time collaborative room app with a Vite + React frontend and an Express + Socket.IO backend.

## Stack

- Frontend: React, Vite, Tailwind CSS, TipTap
- Backend: Node.js, Express, Socket.IO, Prisma
- Database: PostgreSQL
- File storage: local disk for development, S3-compatible storage for production

## Features

- Create and join rooms by room ID
- Private rooms with client-generated secure room keys
- Real-time collaborative rich-text editing
- Automatic persistence to PostgreSQL
- Drag-and-drop file uploads with chunked resumable sessions
- Live file list updates and downloads
- Presence tracking and room cleanup after inactivity

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment files:

- `backend/.env`
- `frontend/.env`

3. Run Prisma migrations:

```bash
npm run prisma:generate -w backend
npm run prisma:migrate -w backend
```

4. Start the app:

```bash
npm run dev
```

## Environment

### Backend

- `DATABASE_URL`
- `PORT`
- `CLIENT_ORIGIN`
- `JWT_SECRET`
- `STORAGE_PROVIDER`
- `LOCAL_STORAGE_DIR`
- `UPLOAD_TMP_DIR`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`

### Frontend

- `VITE_API_URL`
- `VITE_SOCKET_URL`

## Deployment

### Frontend on Netlify

- Build command: `npm run build -w frontend`
- Publish directory: `frontend/dist`

### Backend on Render

- Build command: `npm install && npm run build -w backend`
- Start command: `npm run start -w backend`
- Set the backend environment variables in Render and connect a managed PostgreSQL instance.

## Notes

- Room keys are generated in the browser and only hashed on the server.
- The backend never returns room keys in API responses.
- Room content is persisted automatically and room cleanup runs after 30 minutes without active connections.
