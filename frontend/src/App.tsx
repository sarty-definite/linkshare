import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createRoom, createUploadSession, downloadUrl, fetchRoomState, finalizeUpload, getUploadStatus, joinRoom, roomExists, saveRoomContent, uploadChunk, type FileAsset } from './lib/api';
import { createRoomSocket } from './lib/socket';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Underline from '@tiptap/extension-underline';
import { Socket } from 'socket.io-client';

function randomRoomKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getStoredToken(roomId: string) {
  return window.localStorage.getItem(`link-share:token:${roomId}`) ?? '';
}

function setStoredToken(roomId: string, token: string) {
  window.localStorage.setItem(`link-share:token:${roomId}`, token);
}

function HomePage() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [roomKey, setRoomKey] = useState(randomRoomKey);
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [joinKey, setJoinKey] = useState('');
  const [joinPrompt, setJoinPrompt] = useState<{ roomId: string; privateRoom: boolean } | null>(null);

  async function handleCreate() {
    try {
      setStatus('Creating room...');
      const normalizedRoomId = roomId.trim();
      const response = await createRoom({ roomId: normalizedRoomId, privateRoom: isPrivate, roomKey: isPrivate ? roomKey : undefined });
      setStoredToken(response.roomId, response.accessToken);
      setStatus('Room created.');
      navigate(`/${response.roomId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Room creation failed');
    }
  }

  async function handleJoin() {
    try {
      setStatus('Checking room...');
      const normalizedRoomId = roomId.trim();
      const exists = await roomExists(normalizedRoomId);
      if (!exists.exists) {
        setJoinPrompt({ roomId: normalizedRoomId, privateRoom: isPrivate });
        setStatus('Room does not exist.');
        return;
      }
      const response = await joinRoom({ roomId: normalizedRoomId, roomKey: isPrivate ? joinKey : undefined });
      setStoredToken(response.roomId, response.accessToken);
      navigate(`/${response.roomId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Join failed';
      if (message.includes('404')) {
        setJoinPrompt({ roomId: roomId.trim(), privateRoom: isPrivate });
      }
      setStatus(message);
    }
  }

  return (
    <div className="shell home-shell">
      <div className="backdrop" />
      <main className="panel hero-panel">
        <div className="eyebrow">Link Share</div>
        <h1>Real-time rooms for text and files.</h1>
        <p className="lede">
          Create a room, invite others with a room ID, and keep everything in sync across devices with encrypted transport and persistent storage.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Room ID</span>
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} placeholder="project-alpha" autoComplete="off" />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
            <span>Keep Room Private</span>
          </label>
          {isPrivate && (
            <div className="key-reveal" onMouseEnter={() => setRevealKey(true)} onMouseLeave={() => setRevealKey(false)} onClick={() => setRevealKey((value) => !value)}>
              <div className="key-label">Room key</div>
              <div className="key-value">{revealKey ? roomKey : '••••••••••••••••••••••••••••••••'}</div>
              <button type="button" className="ghost-button" onClick={() => setRoomKey(randomRoomKey())}>Regenerate key</button>
            </div>
          )}
          {isPrivate && (
            <label className="field">
              <span>Key to join a private room</span>
              <input value={joinKey} onChange={(event) => setJoinKey(event.target.value)} placeholder="Paste private room key" autoComplete="off" />
            </label>
          )}
          <div className="actions">
            <button type="button" className="primary-button" onClick={handleCreate}>Create Room</button>
            <button type="button" className="secondary-button" onClick={handleJoin}>Join Room</button>
          </div>
          {status && <div className="status">{status}</div>}
        </div>
      </main>
      {joinPrompt && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Room does not exist. Create it?</h2>
            <p>You can create the room now using the current settings.</p>
            <div className="actions">
              <button type="button" className="primary-button" onClick={handleCreate}>Create it</button>
              <button type="button" className="secondary-button" onClick={() => setJoinPrompt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  return (
    <div className="toolbar">
      <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'active' : ''}>Bold</button>
      <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'active' : ''}>Italic</button>
      <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? 'active' : ''}>Underline</button>
      <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'active' : ''}>H1</button>
      <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}>H2</button>
      <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'active' : ''}>Bullets</button>
      <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'active' : ''}>Numbered</button>
      <button onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>Table</button>
      <button onClick={() => editor.chain().focus().setHardBreak().run()}>Line break</button>
      <button onClick={() => editor.chain().focus().setLink({ href: window.prompt('Enter link URL') ?? '' }).run()}>Link</button>
    </div>
  );
}

function UploadArea({ roomId, token, onUploaded }: { roomId: string; token: string; onUploaded: (file: FileAsset) => void }) {
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState('');

  async function uploadFile(file: File) {
    const init = await createUploadSession(roomId, token, { fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size });
    const chunkSize = init.chunkSize;
    const status = await getUploadStatus(roomId, token, init.uploadId).catch(() => ({ receivedChunks: 0 }));
    const startChunk = status.receivedChunks ?? 0;
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
      await uploadChunk(roomId, token, init.uploadId, chunkIndex, chunk);
      setMessage(`Uploading ${file.name}: ${Math.round(((chunkIndex + 1) / totalChunks) * 100)}%`);
    }

    const uploaded = await finalizeUpload(roomId, token, init.uploadId);
    onUploaded(uploaded as FileAsset);
    setMessage(`Uploaded ${file.name}`);
  }

  return (
    <section
      className={dragActive ? 'upload-area active' : 'upload-area'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void uploadFile(file);
      }}
    >
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />
      <strong>Drag files here or pick one</strong>
      <span>{message || 'Large files are uploaded in chunks and can resume from the last confirmed chunk.'}</span>
    </section>
  );
}

function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => getStoredToken(roomId));
  const [state, setState] = useState<{ presenceCount: number; isPrivate: boolean; files: FileAsset[] } | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState('Connecting...');
  const [joinKey, setJoinKey] = useState('');
  const [joinError, setJoinError] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<number>(0);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Start typing...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell
    ],
    content: { type: 'doc', content: [] },
    onUpdate({ editor }) {
      if (isRemoteUpdate) return;
      const json = editor.getJSON();
      void saveRoomContent(roomId, token, json, remoteVersion).then((response) => setRemoteVersion(response.documentVersion)).catch(() => undefined);
      socket?.emit('room:activity');
      socket?.emit('room:content:update', { documentJson: json, clientVersion: remoteVersion });
    }
  });

  useEffect(() => {
    if (!token) {
      return;
    }

    let mounted = true;
    fetchRoomState(roomId, token)
      .then((response) => {
        if (!mounted) return;
        setState({ presenceCount: response.presenceCount, isPrivate: response.isPrivate, files: response.files });
        setRemoteVersion(response.documentVersion);
        if (editor) {
          setIsRemoteUpdate(true);
          editor.commands.setContent(response.documentJson as Parameters<typeof editor.commands.setContent>[0], false);
          queueMicrotask(() => setIsRemoteUpdate(false));
        }
        setStatus('Connected');
      })
      .catch(() => {
        setStatus('Room access required');
        setToken('');
      });

    return () => {
      mounted = false;
    };
  }, [editor, roomId, token]);

  useEffect(() => {
    if (!token) return;
    const connection = createRoomSocket(roomId, token);
    setSocket(connection);

    connection.on('room:state', (payload: { users: number; isPrivate: boolean; content: unknown; files: FileAsset[] }) => {
      setState((current) => ({
        presenceCount: payload.users,
        isPrivate: payload.isPrivate,
        files: payload.files
      }));
      if (editor) {
        setIsRemoteUpdate(true);
        editor.commands.setContent(payload.content as Parameters<typeof editor.commands.setContent>[0], false);
        queueMicrotask(() => setIsRemoteUpdate(false));
      }
    });
    connection.on('room:content:updated', (payload: { documentJson: unknown; documentVersion: number }) => {
      setRemoteVersion(payload.documentVersion);
      if (editor) {
        setIsRemoteUpdate(true);
        editor.commands.setContent(payload.documentJson as Parameters<typeof editor.commands.setContent>[0], false);
        queueMicrotask(() => setIsRemoteUpdate(false));
      }
    });
    connection.on('room:presence', (payload: { presenceCount: number }) => {
      setState((current) => (current ? { ...current, presenceCount: payload.presenceCount } : current));
    });
    connection.on('room:file:created', (file: FileAsset) => {
      setState((current) => (current ? { ...current, files: [file, ...current.files] } : current));
    });
    connection.on('disconnect', () => setStatus('Disconnected. Reconnecting...'));
    connection.on('connect', () => setStatus('Connected'));
    connection.on('room:error', (payload: { message: string }) => setJoinError(payload.message));

    return () => {
      connection.disconnect();
      setSocket(null);
    };
  }, [editor, roomId, token]);

  if (!roomId) {
    return <Navigate to="/" replace />;
  }

  if (!token) {
    return (
      <div className="shell">
        <main className="panel auth-panel">
          <div className="eyebrow">Join required</div>
          <h1>This room is locked.</h1>
          <p>Enter the private room key or return to the home screen to join properly.</p>
          <label className="field">
            <span>Room key</span>
            <input value={joinKey} onChange={(event) => setJoinKey(event.target.value)} placeholder="Paste key" />
          </label>
          {joinError && <div className="status error">{joinError}</div>}
          <div className="actions">
            <button
              className="primary-button"
              onClick={async () => {
                const response = await joinRoom({ roomId, roomKey: joinKey });
                setStoredToken(roomId, response.accessToken);
                setToken(response.accessToken);
                navigate(`/${roomId}`, { replace: true });
              }}
            >
              Join Room
            </button>
            <button className="secondary-button" onClick={() => navigate('/')}>Back</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell room-shell">
      <header className="room-header panel">
        <div>
          <div className="eyebrow">Room</div>
          <h1>{roomId}</h1>
          <div className="subline">{status}</div>
        </div>
        <div className="room-stats">
          <div><strong>{state?.presenceCount ?? 0}</strong><span>active users</span></div>
          <div><strong>{state?.files.length ?? 0}</strong><span>files</span></div>
        </div>
      </header>

      <section className="panel editor-panel">
        <Toolbar editor={editor} />
        <EditorContent editor={editor} className="editor-surface" />
      </section>

      <section className="panel files-panel">
        <div className="section-head">
          <h2>Files</h2>
          <span>Synced in real time</span>
        </div>
        <UploadArea roomId={roomId} token={token} onUploaded={(file) => setState((current) => current ? { ...current, files: [file, ...current.files] } : current)} />
        <div className="file-list">
          {state?.files.map((file) => (
            <a key={file.id} className="file-card" href={downloadUrl(roomId, file.id)} target="_blank" rel="noreferrer">
              <strong>{file.originalName}</strong>
              <span>{Math.ceil(file.size / 1024)} KB · {file.mimeType}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/:roomId" element={<RoomPage />} />
    </Routes>
  );
}
