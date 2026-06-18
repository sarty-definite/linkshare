import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createRoom, createUploadSession, fetchRoomState, finalizeUpload, getDownloadUrl, getUploadStatus, joinRoom, roomExists, saveRoomContent, uploadChunk, type FileAsset } from './lib/api';
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
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return (array[0] % 1000000).toString().padStart(6, '0');
}

function getStoredToken(roomId: string) {
  return window.localStorage.getItem(`link-share:token:${roomId}`) ?? '';
}

function setStoredToken(roomId: string, token: string) {
  window.localStorage.setItem(`link-share:token:${roomId}`, token);
}

function debounce<T extends (...args: any[]) => void>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

function HomePage() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState<string>('');
  const [joinKey, setJoinKey] = useState('');

  async function handleCreate() {
    try {
      const normalizedRoomId = roomId.trim();
      const trimmedKey = joinKey.trim();
      const hasPrivateKey = Boolean(trimmedKey);

      if (hasPrivateKey && (trimmedKey.length < 4 || trimmedKey.length > 256)) {
        setStatus('Private key must be between 4 and 256 characters long.');
        return;
      }

      setStatus('Creating room...');
      const response = await createRoom({
        roomId: normalizedRoomId,
        privateRoom: hasPrivateKey,
        roomKey: hasPrivateKey ? trimmedKey : undefined
      });
      setStoredToken(response.roomId, response.accessToken);
      if (hasPrivateKey) {
        window.localStorage.setItem(`link-share:key:${response.roomId}`, trimmedKey);
      } else {
        window.localStorage.removeItem(`link-share:key:${response.roomId}`);
      }
      setStatus('Room created.');
      navigate(`/${response.roomId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Room creation failed';
      setStatus(message);
    }
  }

  async function handleJoin() {
    try {
      const normalizedRoomId = roomId.trim();
      const trimmedKey = joinKey.trim();
      const hasPrivateKey = Boolean(trimmedKey);

      if (hasPrivateKey && (trimmedKey.length < 4 || trimmedKey.length > 256)) {
        setStatus('Private key must be between 4 and 256 characters long.');
        return;
      }

      setStatus('Checking room...');
      const exists = await roomExists(normalizedRoomId);
      if (!exists.exists) {
        setStatus('Room does not exist.');
        return;
      }
      const response = await joinRoom({
        roomId: normalizedRoomId,
        roomKey: hasPrivateKey ? trimmedKey : undefined
      });
      setStoredToken(response.roomId, response.accessToken);
      if (hasPrivateKey) {
        window.localStorage.setItem(`link-share:key:${response.roomId}`, trimmedKey);
      } else {
        window.localStorage.removeItem(`link-share:key:${response.roomId}`);
      }
      navigate(`/${response.roomId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Join failed';
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
          <label className="field">
            <span>Private Key</span>
            <div className="input-with-button">
              <input value={joinKey} onChange={(event) => setJoinKey(event.target.value)} placeholder="(Optional)" autoComplete="off" />
              <button type="button" className="inline-button" onClick={() => setJoinKey(randomRoomKey())}>Generate</button>
            </div>
          </label>
          <div className="actions">
            <button type="button" className="primary-button" onClick={handleCreate}>Create Room</button>
            <button type="button" className="secondary-button" onClick={handleJoin}>Join Room</button>
          </div>
          {status && <div className="status">{status}</div>}
        </div>
      </main>
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  return (
    <div className="toolbar">
      <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'active' : ''} title="Bold">
        <strong>B</strong>
      </button>
      <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'active' : ''} title="Italic">
        <em>I</em>
      </button>
      <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? 'active' : ''} title="Underline">
        <u>U</u>
      </button>
      <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'active' : ''} title="Heading 1">
        H₁
      </button>
      <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''} title="Heading 2">
        H₂
      </button>
      <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'active' : ''} title="Bullet List">
        •
      </button>
      <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'active' : ''} title="Numbered List">
        1.
      </button>
      <button onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()} title="Insert Table">
        田
      </button>
      <button onClick={() => editor.chain().focus().setHardBreak().run()} title="Line Break">
        ↵
      </button>
      <button onClick={() => editor.chain().focus().setLink({ href: window.prompt('Enter link URL') ?? '' }).run()} title="Insert Link">
        🔗
      </button>
    </div>
  );
}

function UploadArea({ roomId, token, onUploaded }: { roomId: string; token: string; onUploaded: (file: FileAsset) => void }) {
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState('');

  async function uploadFile(file: File) {
    try {
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
    } catch (error: any) {
      setMessage(error.response?.data?.error || error.message || 'Upload failed');
    }
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
  const { roomId: rawRoomId = '' } = useParams();
  const roomId = rawRoomId.trim();
  const navigate = useNavigate();
  const roomKey = window.localStorage.getItem(`link-share:key:${roomId}`) ?? '';
  const [token, setToken] = useState(() => getStoredToken(roomId));
  const [state, setState] = useState<{ presenceCount: number; isPrivate: boolean; files: FileAsset[] } | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState('Connecting...');
  const [joinKey, setJoinKey] = useState('');
  const [joinError, setJoinError] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<number>(0);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [isRoomKeyRequired, setIsRoomKeyRequired] = useState(false);
  const [activeTab, setActiveTab] = useState<'text' | 'files'>('text');

  const lastRoomIdRef = useRef(roomId);
  const joinInitiatedRef = useRef(false);

  if (lastRoomIdRef.current !== roomId) {
    lastRoomIdRef.current = roomId;
    joinInitiatedRef.current = false;
  }

  const debouncedSave = useMemo(() => {
    return debounce((json: any, version: number) => {
      void saveRoomContent(roomId, token, json, version)
        .then((response) => setRemoteVersion(response.documentVersion))
        .catch(() => undefined);
      socket?.emit('room:content:update', { documentJson: json, clientVersion: version });
    }, 1000);
  }, [roomId, token, socket]);

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
      debouncedSave(json, remoteVersion);
      socket?.emit('room:activity');
    }
  });

  useEffect(() => {
    if (token) return;
    if (joinInitiatedRef.current) return;
    joinInitiatedRef.current = true;

    joinRoom({ roomId })
      .then((response) => {
        setStoredToken(response.roomId, response.accessToken);
        window.localStorage.removeItem(`link-share:key:${response.roomId}`);
        setToken(response.accessToken);
      })
      .catch((error: any) => {
        const errMsg = error.response?.data?.error || error.message || '';
        if (errMsg.includes('key required') || errMsg.includes('Room key required')) {
          setIsRoomKeyRequired(true);
        } else {
          setIsRoomKeyRequired(true);
        }
        setJoinError(errMsg);
        setAutoJoinAttempted(true);
      });
  }, [roomId, token]);

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
    if (!autoJoinAttempted) {
      return (
        <div className="shell">
          <main className="panel auth-panel">
            <div className="eyebrow">Link Share</div>
            <h1>Entering room...</h1>
            <div className="status">{status}</div>
          </main>
        </div>
      );
    }

    if (isRoomKeyRequired) {
      return (
        <div className="shell">
          <main className="panel auth-panel">
            <div className="eyebrow">Join required</div>
            {joinError && joinError == "Room key required." && (
              <div>
                <h1>This room is locked.</h1>
                <p>Enter the private room key or return to the home screen to join properly.</p>
                <label className="field">
                  <span>Room key</span>
                  <input value={joinKey} onChange={(event) => setJoinKey(event.target.value)} placeholder="Paste key" />
                </label>
                <div className="actions">
                  <button
                    className="primary-button"
                    onClick={async () => {
                      try {
                        const trimmedKey = joinKey.trim();
                        if (!trimmedKey) {
                          setJoinError('Room key is required.');
                          return;
                        }
                        if (trimmedKey.length < 4 || trimmedKey.length > 256) {
                          setJoinError('Private key must be between 4 and 256 characters long.');
                          return;
                        }
                        const response = await joinRoom({ roomId, roomKey: trimmedKey });
                        setStoredToken(roomId, response.accessToken);
                        window.localStorage.setItem(`link-share:key:${roomId}`, trimmedKey);
                        setToken(response.accessToken);
                        navigate(`/${roomId}`, { replace: true });
                      } catch (err: any) {
                        setJoinError(err.response?.data?.error || err.message || 'Join failed');
                      }
                    }}
                  >
                    Join Room
                  </button>
                  <button className="secondary-button" onClick={() => navigate('/')}>Back</button>
                </div>
              </div>
            )}
            {joinError && joinError != "Room key required." &&
              <>
                <div>
                  <h1>{joinError}</h1>
                </div>
                <div className="actions">
                  <button className="secondary-button" onClick={() => navigate('/')}>Back</button>
                </div>
              </>
            }

          </main>
        </div>
      );
    }
  }

  return (
    <div className="shell room-shell">
      <header className="room-header panel">
        <div className="room-header-left">
          <div className="room-title-area">
            <span className="eyebrow">Room</span>
            <h1>{roomId}</h1>
            <span className="subline">({status})</span>
          </div>
          <div className="room-action-buttons">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void navigator.clipboard.writeText(window.location.href);
                alert('Room link copied to clipboard!');
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Copy Link
            </button>
            {state?.isPrivate && roomKey && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void navigator.clipboard.writeText(roomKey);
                  alert('Private key copied to clipboard!');
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
                Copy Key
              </button>
            )}
          </div>
        </div>
        <div className="room-stats">
          <div>
            <span>users</span>
            <strong>{state?.presenceCount ?? 0}</strong>
          </div>
          <div>
            <span>files</span>
            <strong>{state?.files.length ?? 0}</strong>
          </div>
        </div>
      </header>

      <div className="mobile-tab-toggle">
        <button
          type="button"
          className={activeTab === 'text' ? 'active' : ''}
          onClick={() => setActiveTab('text')}
        >
          Text Editor
        </button>
        <button
          type="button"
          className={activeTab === 'files' ? 'active' : ''}
          onClick={() => setActiveTab('files')}
        >
          Files ({state?.files.length ?? 0})
        </button>
      </div>

      <div className="room-main-layout">
        <section className={`panel editor-panel ${activeTab === 'text' ? 'tab-visible' : 'tab-hidden'}`} style={{ display: 'flex', flexDirection: 'column' }}>
          <Toolbar editor={editor} />
          <EditorContent editor={editor} className="editor-surface" style={{ flex: 1, minHeight: '380px' }} />
        </section>

        <section className={`panel files-panel ${activeTab === 'files' ? 'tab-visible' : 'tab-hidden'}`}>
          <div className="section-head">
            <h2>Files</h2>
            <span>Synced in real time</span>
          </div>
          <UploadArea roomId={roomId} token={token} onUploaded={() => setState((current) => current)} />
          <div className="file-list">
            {state?.files.map((file) => (
              <button
                key={file.id}
                className="file-card"
                title="Download"
                onClick={async () => {
                  try {
                    const url = await getDownloadUrl(roomId, file.id, token);
                    window.open(url, '_blank');
                  } catch {
                    alert('Download failed');
                  }
                }}
              >
                <strong>{file.originalName}</strong>
                <span>
                  {file.size > 1024 * 1024
                    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                    : `${Math.ceil(file.size / 1024)} KB`}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
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
