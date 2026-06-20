import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createRoom, createUploadSession, fetchRoomState, finalizeUpload, getDownloadUrl, getUploadStatus, joinRoom, roomExists, saveRoomContent, uploadChunk, cancelUpload, deleteFile, type FileAsset } from './lib/api';
import { generateInstantRoomId } from './lib/room-generator';
import { createRoomSocket } from './lib/socket';
import { BubbleMenu, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Underline from '@tiptap/extension-underline';
import { Socket } from 'socket.io-client';
import axios from 'axios';
import * as Y from 'yjs';
import Collaboration from '@tiptap/extension-collaboration';

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

  async function handleInstantCreate() {
    try {
      setStatus('Generating unique room ID...');
      const generatedId = await generateInstantRoomId();
      setStatus('Creating room...');
      const response = await createRoom({
        roomId: generatedId,
        privateRoom: false
      });
      setStoredToken(response.roomId, response.accessToken);
      window.localStorage.removeItem(`link-share:key:${response.roomId}`);
      setStatus('Room created.');
      navigate(`/${response.roomId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Instant creation failed';
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
        <div className="eyebrow">We Ping</div>
        <h1>Real-time rooms for text and files.</h1>
        <p className="lede">
          Create a room, invite others with a room ID, and keep everything in sync across devices with encrypted transport and persistent storage.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Room ID</span>
            <div className="input-with-button">
              <input
                className="room-id-input"
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                placeholder="project-alpha"
                autoComplete="off"
              />
              <button
                type="button"
                className="instant-inline-button"
                onClick={handleInstantCreate}
                title="Instant Create Room"
              >
                ⚡ Instant
              </button>
            </div>
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

import { formattingActions } from './config/editor-formatting';

function Toolbar({ editor }: { editor: any }) {
  if (!editor) return null;
  const isLink = editor.isActive('link');
  const linkHref = isLink ? editor.getAttributes('link').href : '';

  return (
    <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {formattingActions.map((item) => (
          <button
            key={item.title}
            onClick={() => item.action(editor)}
            className={item.isActive(editor) ? 'active' : ''}
            title={item.title}
          >
            {item.label}
          </button>
        ))}
      </div>
      {isLink && linkHref && (
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="toolbar-link-preview"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '6px',
            background: 'rgba(56, 189, 248, 0.15)',
            color: 'var(--accent)',
            fontSize: '0.82rem',
            fontWeight: '600',
            border: '1px solid rgba(125, 211, 252, 0.3)',
            transition: 'all 140ms ease',
            textDecoration: 'none'
          }}
        >
          Open Link ↗
        </a>
      )}
    </div>
  );
}

function UploadArea({ roomId, token, onUploaded }: { roomId: string; token: string; onUploaded: (file: FileAsset) => void }) {
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function cancelCurrentUpload() {
    if (!uploadId) return;
    try {
      setMessage('Cancelling upload...');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      await cancelUpload(roomId, token, uploadId);
      setMessage('Upload cancelled.');
    } catch (err: any) {
      setMessage(`Cancellation failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      setUploadId(null);
      abortControllerRef.current = null;
    }
  }

  async function uploadFile(file: File) {
    if (isUploading) {
      alert('An upload is already in progress. Please wait until it completes or cancel it.');
      return;
    }

    setIsUploading(true);
    setMessage(`Starting upload for ${file.name}...`);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Dynamically determine chunk size based on file size and previous upload speed
      let chosenChunkSize = 5 * 1024 * 1024; // Default 5 MB
      const storedSpeed = window.localStorage.getItem('link-share:last-upload-speed');
      
      if (storedSpeed) {
        const speed = parseFloat(storedSpeed); // bytes per second
        if (speed < 500 * 1024) {
          chosenChunkSize = 1 * 1024 * 1024; // 1 MB on slow networks
        } else if (speed < 1.5 * 1024 * 1024) {
          chosenChunkSize = 2 * 1024 * 1024; // 2 MB on medium networks
        } else if (speed > 4 * 1024 * 1024) {
          chosenChunkSize = 10 * 1024 * 1024; // 10 MB on very fast networks
        }
      } else {
        // Fallback to size-based chunk sizes if no speed data exists
        if (file.size < 10 * 1024 * 1024) {
          chosenChunkSize = 1 * 1024 * 1024; // 1 MB for small files
        } else if (file.size < 50 * 1024 * 1024) {
          chosenChunkSize = 2 * 1024 * 1024; // 2 MB for medium files
        }
      }

      const startTime = Date.now();

      const init = await createUploadSession(roomId, token, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        chunkSize: chosenChunkSize
      });
      
      setUploadId(init.uploadId);
      const chunkSize = init.chunkSize;
      const totalChunks = Math.ceil(file.size / chunkSize);

      let uploaded;

      if (init.presignedUrls && init.presignedUrls.length > 0) {
        // Direct S3/R2 upload flow: upload chunks directly to Cloudflare R2
        const parts: { PartNumber: number; ETag: string }[] = [];
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * chunkSize;
          const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
          
          const response = await axios.put(init.presignedUrls[chunkIndex]!, chunk, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream'
            },
            signal: controller.signal
          });
          
          const etag = response.headers.etag;
          if (!etag) {
            throw new Error(`Failed to retrieve ETag for chunk ${chunkIndex}`);
          }
          
          parts.push({
            PartNumber: chunkIndex + 1,
            ETag: etag
          });
          
          setMessage(`Uploading ${file.name}: ${Math.round(((chunkIndex + 1) / totalChunks) * 100)}%`);
        }
        
        uploaded = await finalizeUpload(roomId, token, init.uploadId, parts);
      } else {
        // Local backend fallback
        const status = await getUploadStatus(roomId, token, init.uploadId).catch(() => ({ receivedChunks: 0 }));
        const startChunk = status.receivedChunks ?? 0;

        for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * chunkSize;
          const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
          await uploadChunk(roomId, token, init.uploadId, chunkIndex, chunk, controller.signal);
          setMessage(`Uploading ${file.name}: ${Math.round(((chunkIndex + 1) / totalChunks) * 100)}%`);
        }

        uploaded = await finalizeUpload(roomId, token, init.uploadId);
      }
      
      // Calculate and store actual transfer speed (in bytes/sec)
      const durationSec = (Date.now() - startTime) / 1000;
      if (durationSec > 0.5) {
        const transferSpeed = file.size / durationSec;
        window.localStorage.setItem('link-share:last-upload-speed', transferSpeed.toString());
      }

      onUploaded(uploaded as FileAsset);
      setMessage(`Uploaded ${file.name}`);
      setIsUploading(false);
      setUploadId(null);
      abortControllerRef.current = null;
    } catch (error: any) {
      if (axios.isCancel(error) || error.name === 'CanceledError' || error.message === 'canceled') {
        // Already handled in cancelCurrentUpload
        return;
      }
      setMessage(error.response?.data?.error || error.message || 'Upload failed');
      setIsUploading(false);
      setUploadId(null);
      abortControllerRef.current = null;
    }
  }

  return (
    <section
      className={`${dragActive ? 'upload-area active' : 'upload-area'} ${isUploading ? 'uploading' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!isUploading) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (isUploading) return;
        const file = event.dataTransfer.files?.[0];
        if (file) void uploadFile(file);
      }}
    >
      <input
        type="file"
        disabled={isUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />
      <strong>{isUploading ? 'Uploading file...' : 'Drag files here or pick one'}</strong>
      <span>{message || 'Large files are uploaded in chunks and can resume from the last confirmed chunk.'}</span>
      {isUploading && (
        <button
          type="button"
          className="cancel-button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            void cancelCurrentUpload();
          }}
          style={{
            zIndex: 10,
            marginTop: '12px',
            backgroundColor: 'var(--danger)',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600'
          }}
        >
          Cancel Upload
        </button>
      )}
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

  // Initialize a persistent local Yjs document
  const [ydoc] = useState(() => new Y.Doc());

  if (lastRoomIdRef.current !== roomId) {
    lastRoomIdRef.current = roomId;
    joinInitiatedRef.current = false;
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.extend({
        renderHTML({ HTMLAttributes }) {
          return ['a', { ...HTMLAttributes, title: `Ctrl+Click to open: ${HTMLAttributes.href}` }, 0];
        }
      }).configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Start typing...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Tie the editor to the local Yjs document
      Collaboration.configure({
        document: ydoc
      }) as any
    ],
    editorProps: {
      handleClick(view, pos, event) {
        const target = event.target as HTMLElement;
        if (target && target.tagName === 'A') {
          if (event.ctrlKey || event.metaKey) {
            const href = target.getAttribute('href');
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer');
              return true;
            }
          }
        }
        return false;
      }
    },
    onUpdate({ editor }) {
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

  // Fetch initial room state and handle legacy JSON migrations
  useEffect(() => {
    if (!token || !socket) {
      return;
    }

    let mounted = true;
    fetchRoomState(roomId, token)
      .then((response) => {
        if (!mounted) return;
        setState({ presenceCount: response.presenceCount, isPrivate: response.isPrivate, files: response.files });
        setRemoteVersion(response.documentVersion);
        
        const content = response.documentJson;
        if (content && typeof content === 'object' && (content as any).type === 'yjs') {
          // Document content will be automatically synchronized via Socket.io/Yjs binary protocol
        } else {
          // Seed the editor (and the ydoc) with legacy JSON content if it exists
          if (editor && content) {
            setIsRemoteUpdate(true);
            editor.commands.setContent(content, false);
            queueMicrotask(() => setIsRemoteUpdate(false));
          }
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
  }, [editor, socket, roomId, token]);

  // Bind the local Yjs document to Socket.io events
  useEffect(() => {
    if (!token) return;
    const connection = createRoomSocket(roomId, token);
    setSocket(connection);

    // Listen to local Yjs document updates and send them to the server
    const handleLocalUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== connection) {
        connection.emit('yjs:update', update);
      }
    };
    ydoc.on('update', handleLocalUpdate);

    // Listen to remote updates from other clients via the server
    connection.on('yjs:update', (updateBuffer: ArrayBuffer) => {
      const update = new Uint8Array(updateBuffer);
      Y.applyUpdate(ydoc, update, connection);
    });

    // Listen to sync request from the server (Sync Step 1)
    connection.on('yjs:sync:request', (serverStateVectorBuffer: ArrayBuffer) => {
      const serverStateVector = new Uint8Array(serverStateVectorBuffer);
      
      // Reply with our missing updates
      const update = Y.encodeStateAsUpdate(ydoc, serverStateVector);
      connection.emit('yjs:sync:reply', update);

      // Also request what updates we are missing from the server
      const clientStateVector = Y.encodeStateVector(ydoc);
      connection.emit('yjs:sync:request', clientStateVector);
    });

    // Handle server sync response (Sync Step 2)
    connection.on('yjs:sync:reply', (serverUpdateBuffer: ArrayBuffer) => {
      const serverUpdate = new Uint8Array(serverUpdateBuffer);
      Y.applyUpdate(ydoc, serverUpdate, connection);
    });

    connection.on('room:presence', (payload: { presenceCount: number }) => {
      setState((current) => (current ? { ...current, presenceCount: payload.presenceCount } : current));
    });
    connection.on('room:file:created', (file: FileAsset) => {
      setState((current) => (current ? { ...current, files: [file, ...current.files] } : current));
    });
    connection.on('room:file:deleted', (payload: { fileId: string }) => {
      setState((current) => {
        if (!current) return null;
        return {
          ...current,
          files: current.files.filter((f) => f.id !== payload.fileId)
        };
      });
    });
    connection.on('disconnect', () => setStatus('Disconnected. Reconnecting...'));
    connection.on('connect', () => setStatus('Connected'));
    connection.on('room:error', (payload: { message: string }) => setJoinError(payload.message));

    return () => {
      ydoc.off('update', handleLocalUpdate);
      connection.disconnect();
      setSocket(null);
    };
  }, [ydoc, roomId, token]);

  if (!roomId) {
    return <Navigate to="/" replace />;
  }

  if (!token) {
    if (!autoJoinAttempted) {
      return (
        <div className="shell">
          <main className="panel auth-panel">
            <div className="eyebrow">We Ping</div>
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
          {editor && (
            <BubbleMenu
              editor={editor}
              tippyOptions={{ duration: 150 }}
              shouldShow={({ editor }) => editor.isActive('link')}
            >
              <div className="link-bubble-menu">
                <span>Link:</span>
                <a
                  href={editor.getAttributes('link').href || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {editor.getAttributes('link').href}
                </a>
              </div>
            </BubbleMenu>
          )}
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
              <div
                key={file.id}
                className="file-card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'default'
                }}
              >
                <button
                  type="button"
                  title="Download"
                  onClick={async () => {
                    try {
                      const url = await getDownloadUrl(roomId, file.id, token);
                      window.open(url, '_blank');
                    } catch {
                      alert('Download failed');
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    textAlign: 'left',
                    flex: 1,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 0
                  }}
                >
                  <strong>{file.originalName}</strong>
                  <span style={{ marginRight: '16px' }}>
                    {file.size > 1024 * 1024
                      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                      : `${Math.ceil(file.size / 1024)} KB`}
                  </span>
                </button>
                <button
                  type="button"
                  title="Delete File"
                  onClick={async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (confirm(`Are you sure you want to delete ${file.originalName}?`)) {
                      try {
                        await deleteFile(roomId, token, file.id);
                      } catch (err: any) {
                        alert(`Failed to delete: ${err.message}`);
                      }
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'opacity 140ms ease'
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = '0.7')}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  🗑️
                </button>
              </div>
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
