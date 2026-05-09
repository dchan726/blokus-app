import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  RotateCw, FlipHorizontal, Check, Users, AlertCircle, Play, 
  SkipForward, LogOut, RotateCcw, Flag, Trash2, ShieldAlert,
  Vibrate, VibrateOff, StopCircle, Trophy, User, RefreshCw, Edit3, Mail, Lock
} from 'lucide-react';

// --- 您專屬的 Firebase 設定 ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// --- 遊戲常數與設定 ---
const BOARD_SIZE = 20;

const PIECE_SHAPES_STR = [
  ["X"], ["XX"], ["XXX"], ["XX", "X "], ["XXXX"], 
  ["XXX", "X  "], ["XXX", " X "], ["XX", "XX"], ["XX ", " XX"], ["XXXXX"], 
  ["XXXX", "X   "], ["XXXX", " X  "], ["XXX", "XX "], ["XXX", "X X"], ["XXX", "X  ", "X  "], 
  ["XX ", " XX", "  X"], [" XX", "XX ", " X "], ["XX ", " X ", " XX"], ["XXX", " X ", " X "], [" X ", "XXX", " X "], 
  ["XXX ", "  XX"]
];

const INITIAL_PIECES = PIECE_SHAPES_STR.map(shape => {
  const coords = [];
  shape.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'X') coords.push([y, x]);
    }
  });
  return coords;
});

const COLORS = [
  { name: '紅色', hex: '#EF4444', border: 'border-red-600', bg: 'bg-red-500', start: [0, 0] },
  { name: '藍色', hex: '#3B82F6', border: 'border-blue-600', bg: 'bg-blue-500', start: [0, 19] },
  { name: '黃色', hex: '#EAB308', border: 'border-yellow-600', bg: 'bg-yellow-500', start: [19, 19] },
  { name: '綠色', hex: '#22C55E', border: 'border-green-600', bg: 'bg-green-500', start: [19, 0] }
];

// --- 幫助函數 ---
function normalizeCoords(coords) {
  const minY = Math.min(...coords.map(c => c[0]));
  const minX = Math.min(...coords.map(c => c[1]));
  return coords.map(([y, x]) => [y - minY, x - minX]);
}

function transformPiece(coords, rot, flipX) {
  let transformed = coords.map(([y, x]) => {
    let ny = y, nx = x;
    if (flipX) nx = -nx;
    for (let i = 0; i < rot; i++) {
      const temp = ny;
      ny = nx;
      nx = -temp;
    }
    return [ny, nx];
  });
  return normalizeCoords(transformed);
}

function validateMove(board, playerIndex, pieceCoords, startY, startX) {
  const isFirstMove = !board.some(row => row.includes(playerIndex));
  let hasCornerTouch = false;
  const startPos = COLORS[playerIndex].start;

  for (const [dy, dx] of pieceCoords) {
    const y = startY + dy;
    const x = startX + dx;

    if (y < 0 || y >= BOARD_SIZE || x < 0 || x >= BOARD_SIZE) return false;
    if (board[y][x] !== null) return false;

    const edges = [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]];
    for (const [ey, ex] of edges) {
      if (ey >= 0 && ey < BOARD_SIZE && ex >= 0 && ex < BOARD_SIZE) {
        if (board[ey][ex] === playerIndex) return false;
      }
    }

    const corners = [[y - 1, x - 1], [y - 1, x + 1], [y + 1, x - 1], [y + 1, x + 1]];
    for (const [cy, cx] of corners) {
      if (cy >= 0 && cy < BOARD_SIZE && cx >= 0 && cx < BOARD_SIZE) {
        if (board[cy][cx] === playerIndex) hasCornerTouch = true;
      }
    }

    if (isFirstMove && y === startPos[0] && x === startPos[1]) {
      hasCornerTouch = true;
    }
  }

  return hasCornerTouch;
}

const MiniPiece = ({ coords, colorClass, onClick, isSelected }) => {
  const maxY = Math.max(...coords.map(c => c[0]));
  const maxX = Math.max(...coords.map(c => c[1]));
  
  const grid = Array(maxY + 1).fill(null).map(() => Array(maxX + 1).fill(false));
  coords.forEach(([y, x]) => { grid[y][x] = true; });

  return (
    <div 
      className={`p-1 cursor-pointer transition-transform ${isSelected ? 'scale-110 ring-2 ring-offset-2 ring-gray-400 bg-slate-700/50 rounded-lg' : 'hover:scale-105'}`}
      onClick={onClick}
    >
      <div className="flex flex-col gap-px" style={{ width: 'fit-content' }}>
        {grid.map((row, y) => (
          <div key={y} className="flex gap-px">
            {row.map((isFilled, x) => (
              <div 
                key={x} 
                className={`w-[10px] h-[10px] sm:w-3 sm:h-3 lg:w-[14px] lg:h-[14px] ${isFilled ? `${colorClass} piece-3d` : 'bg-transparent'}`} 
                style={{ borderRadius: '2px' }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};


export default function App() {
  const [authReady, setAuthReady] = useState(false); 
  const [user, setUser] = useState(null); 
  const [db, setDb] = useState(null);
  const [authInstance, setAuthInstance] = useState(null);
  const [appId] = useState('blokus-custom');
  
  const [roomId, setRoomId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [roomsList, setRoomsList] = useState([]);
  const [userName, setUserName] = useState('');
  const [view, setView] = useState('login'); 

  // 登入/註冊狀態
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isProcessingAuth, setIsProcessingAuth] = useState(false);

  const [selectedPieceIndex, setSelectedPieceIndex] = useState(null);
  const [transform, setTransform] = useState({ rot: 0, flipX: false });
  const [stagingPos, setStagingPos] = useState(null);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(false); 
  const [isSyncing, setIsSyncing] = useState(false);

  // 初始化 Firebase
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const firestore = getFirestore(app);
        
        setAuthInstance(auth);
        setDb(firestore);

        // 監聽登入狀態 (包含重新整理時的自動恢復)
        onAuthStateChanged(auth, (currentUser) => {
          if (currentUser) {
            setUser(currentUser);
            setUserName(currentUser.displayName || `玩家_${currentUser.uid.substring(0, 4)}`);
            // 如果原本在 login 畫面，登入成功就跳轉到 home。若在其他畫面(如 game)則保留。
            setView(prev => prev === 'login' ? 'home' : prev);
          } else {
            setUser(null);
            setView('login'); // 沒有登入就強制回登入畫面
          }
          setAuthReady(true);
        });
      } catch (err) {
        console.error("Firebase 初始化失敗:", err);
      }
    };
    initFirebase();
  }, []);

  // --- Auth 相關函數 ---
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (isRegisterMode && !userName.trim()) {
      setAuthError('請填寫玩家姓名');
      return;
    }

    setIsProcessingAuth(true);
    setAuthError('');

    try {
      if (isRegisterMode) {
        const cred = await createUserWithEmailAndPassword(authInstance, email, password);
        await updateProfile(cred.user, { displayName: userName });
        setUserName(userName);
      } else {
        await signInWithEmailAndPassword(authInstance, email, password);
      }
      // onAuthStateChanged 會自動處理畫面跳轉
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') setAuthError('此信箱已被註冊');
      else if (err.code === 'auth/invalid-credential') setAuthError('信箱或密碼錯誤');
      else if (err.code === 'auth/weak-password') setAuthError('密碼強度太弱 (至少 6 字元)');
      else setAuthError('登入發生錯誤，請稍後再試');
    } finally {
      setIsProcessingAuth(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("確定要登出嗎？")) {
      await signOut(authInstance);
      setEmail('');
      setPassword('');
      setRoomId('');
      setRoomData(null);
    }
  };

  // --- 遊戲邏輯與監聽 ---

  // 監聽所有房間列表
  useEffect(() => {
    if (!db || !user || (view !== 'home' && view !== 'login')) return;
    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms');
    const unsubscribe = onSnapshot(roomsRef, (snapshot) => {
      const list = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        list.push({ id: doc.id, ...data });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setRoomsList(list);
    });
    return () => unsubscribe();
  }, [db, view, appId, user]);

  // 監聽單一房間資料
  useEffect(() => {
    if (!user || !db || !roomId || view === 'home' || view === 'login') return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.board && typeof data.board === 'string') data.board = JSON.parse(data.board);
        if (data.piecesLeft && typeof data.piecesLeft === 'string') data.piecesLeft = JSON.parse(data.piecesLeft);
        if (!data.surrendered) data.surrendered = [false, false, false, false];
        setRoomData(data);
      } else {
        setRoomData(null);
        if (view !== 'home') setView('home'); 
      }
    }, (err) => {
      console.error("讀取房間資料失敗:", err);
    });

    return () => unsubscribe();
  }, [user, db, roomId, view, appId]);

  // 同步房間狀態到視圖
  useEffect(() => {
    if (!roomData) return;
    if (roomData.status === 'lobby' && view === 'game') {
      setView('lobby');
    } 
    else if (roomData.status === 'playing' && view === 'lobby') {
      setView('game');
    }
  }, [roomData?.status, view]);

  // 自動跳過已投降的玩家回合
  useEffect(() => {
    if (!roomData || roomData.status !== 'playing' || !db || !roomId || !user) return;
    
    // 使用 user.uid 判斷是否為房主
    if (roomData.host === user.uid) {
      const currentSlot = roomData.currentTurn;
      if (roomData.surrendered && roomData.surrendered[currentSlot]) {
        const timer = setTimeout(async () => {
          const newPassCount = roomData.passCount + 1;
          const nextStatus = newPassCount >= 4 ? 'finished' : 'playing';
          
          const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
          await updateDoc(roomRef, {
            currentTurn: (currentSlot + 1) % 4,
            passCount: newPassCount,
            status: nextStatus
          });
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [roomData?.currentTurn, roomData?.status, roomData?.surrendered, roomData?.host, user?.uid, db, roomId, appId]);

  // 重置本地選擇狀態
  useEffect(() => {
    setSelectedPieceIndex(null);
    setStagingPos(null);
    setTransform({ rot: 0, flipX: false });
    setConfirmSurrender(false);
  }, [roomData?.currentTurn]);


  const handleForceSync = async () => {
    if (!db || !roomId) return;
    setIsSyncing(true);
    try {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
      const snapshot = await getDoc(roomRef);
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.board && typeof data.board === 'string') data.board = JSON.parse(data.board);
        if (data.piecesLeft && typeof data.piecesLeft === 'string') data.piecesLeft = JSON.parse(data.piecesLeft);
        if (!data.surrendered) data.surrendered = [false, false, false, false];
        setRoomData(data);
      }
    } catch (err) {
      console.error("強制同步失敗:", err);
    } finally {
      setTimeout(() => setIsSyncing(false), 800); 
    }
  };

  const handleJoinOrCreate = async (targetRoomId) => {
    const idToUse = targetRoomId || roomId;
    if (!idToUse.trim() || !user) return;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', idToUse.toUpperCase());
    const snapshot = await getDoc(roomRef);

    if (!snapshot.exists()) {
      const initialBoard = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
      const initialPieces = Array(4).fill().map(() => Array.from({ length: 21 }, (_, i) => i));

      const newRoom = {
        status: 'lobby',
        host: user.uid, // 使用真正的帳號 UID
        slots: [null, null, null, null],
        board: JSON.stringify(initialBoard),
        currentTurn: 0,
        piecesLeft: JSON.stringify(initialPieces),
        passCount: 0,
        surrendered: [false, false, false, false],
        createdAt: Date.now()
      };
      await setDoc(roomRef, newRoom);
    }
    setRoomId(idToUse.toUpperCase());
    setView('lobby');
  };

  const handleAdminClearAll = async () => {
    if (!isAdmin || !db) return;
    if (window.confirm("確定要清除伺服器上所有的房間嗎？這將會中斷正在進行的遊戲。")) {
      for (const room of roomsList) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', room.id));
      }
    }
  };

  const handleLeaveRoom = () => {
    setView('home');
    setRoomId('');
  };

  const handleDeleteRoom = async () => {
    if (!roomData || roomData.host !== user?.uid || !db) return;
    if (!window.confirm("確定要解散並刪除這個房間嗎？所有玩家將會被踢出。")) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await deleteDoc(roomRef);
    setView('home');
    setRoomId('');
  };

  const handleRestartRoom = async () => {
    if (!roomData || roomData.host !== user?.uid || !db) return;
    const initialBoard = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
    const initialPieces = Array(4).fill().map(() => Array.from({ length: 21 }, (_, i) => i));
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      status: 'lobby',
      board: JSON.stringify(initialBoard),
      currentTurn: 0,
      piecesLeft: JSON.stringify(initialPieces),
      passCount: 0,
      surrendered: [false, false, false, false],
      slots: [null, null, null, null] 
    });
  };

  const handleForceEndGame = async () => {
    if (!roomData || roomData.host !== user?.uid) return;
    if (!window.confirm("確定要強制結束這場遊戲並進行結算嗎？")) return;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, { status: 'finished' });
  };

  const handleClaimSlot = async (slotIndex) => {
    if (!roomData || roomData.status !== 'lobby') return;
    const newSlots = [...roomData.slots];
    newSlots[slotIndex] = { uid: user.uid, name: userName };
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, { slots: newSlots });
  };

  const handleLeaveSlot = async (slotIndex) => {
    if (!roomData || roomData.status !== 'lobby') return;
    const newSlots = [...roomData.slots];
    if (newSlots[slotIndex]?.uid === user.uid) {
      newSlots[slotIndex] = null;
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
      await updateDoc(roomRef, { slots: newSlots });
    }
  };

  const handleStartGame = async () => {
    if (!roomData || roomData.slots.some(s => s === null)) {
      alert("請確保所有 4 個顏色都有玩家加入！");
      return;
    }
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, { 
      status: 'playing',
      currentTurn: 0,
      passCount: 0,
      surrendered: [false, false, false, false]
    });
  };

  const isMyTurn = roomData && 
                   roomData.status === 'playing' && 
                   roomData.slots[roomData.currentTurn]?.uid === user?.uid &&
                   !(roomData.surrendered && roomData.surrendered[roomData.currentTurn]);
  const currentColor = roomData?.currentTurn ?? 0;

  const activePieceCoords = useMemo(() => {
    if (selectedPieceIndex === null) return [];
    return transformPiece(INITIAL_PIECES[selectedPieceIndex], transform.rot, transform.flipX);
  }, [selectedPieceIndex, transform]);

  const isMoveValid = useMemo(() => {
    if (!stagingPos || !roomData || selectedPieceIndex === null) return false;
    return validateMove(roomData.board, currentColor, activePieceCoords, stagingPos.y, stagingPos.x);
  }, [stagingPos, roomData, activePieceCoords, currentColor, selectedPieceIndex]);

  const handleBoardClick = (y, x) => {
    if (!isMyTurn || selectedPieceIndex === null) return;
    setStagingPos({ y, x });
  };

  const handleConfirmMove = async () => {
    if (!isMyTurn || !isMoveValid || !stagingPos || selectedPieceIndex === null) return;

    if (vibrationEnabled && navigator.vibrate) {
      navigator.vibrate([40]); 
    }

    const newBoard = roomData.board.map(row => [...row]);
    activePieceCoords.forEach(([dy, dx]) => {
      newBoard[stagingPos.y + dy][stagingPos.x + dx] = currentColor;
    });

    const newPiecesLeft = roomData.piecesLeft.map(arr => [...arr]);
    newPiecesLeft[currentColor] = newPiecesLeft[currentColor].filter(idx => idx !== selectedPieceIndex);

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      board: JSON.stringify(newBoard),
      piecesLeft: JSON.stringify(newPiecesLeft),
      currentTurn: (currentColor + 1) % 4,
      passCount: 0
    });
  };

  const handlePassTurn = async () => {
    if (!isMyTurn) return;
    
    const newPassCount = roomData.passCount + 1;
    let nextStatus = roomData.status;
    if (newPassCount >= 4) nextStatus = 'finished';

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      currentTurn: (currentColor + 1) % 4,
      passCount: newPassCount,
      status: nextStatus
    });
  };

  const handleSurrender = async () => {
    if (!isMyTurn) return;
    if (!confirmSurrender) {
      setConfirmSurrender(true);
      return;
    }
    
    const newSurrendered = roomData.surrendered ? [...roomData.surrendered] : [false, false, false, false];
    newSurrendered[currentColor] = true;
    
    const newPassCount = roomData.passCount + 1;
    let nextStatus = roomData.status;
    if (newPassCount >= 4) nextStatus = 'finished';

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      surrendered: newSurrendered,
      currentTurn: (currentColor + 1) % 4,
      passCount: newPassCount,
      status: nextStatus
    });
  };

  const calculateScores = useCallback(() => {
    if (!roomData || !roomData.piecesLeft) return [0,0,0,0];
    return roomData.piecesLeft.map(pieces => {
      let squares = 0;
      pieces.forEach(pIdx => {
        squares += INITIAL_PIECES[pIdx].length;
      });
      return squares;
    });
  }, [roomData]);


  // --- 畫面渲染 ---

  // 尚未完成 Firebase 狀態檢查前顯示載入中
  if (!authReady) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-slate-300">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
        <p>連線驗證中...</p>
      </div>
    );
  }

  // 登入/註冊畫面
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans text-white">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mb-2 tracking-tight">角鬥士棋 3D版</h1>
          <p className="text-slate-400">登入帳號以保存您的進度與身分</p>
        </div>

        <form onSubmit={handleAuthSubmit} className="bg-slate-800 p-8 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-slate-700 max-w-sm w-full">
          <h2 className="text-2xl font-bold mb-6 text-center text-slate-100">
            {isRegisterMode ? '建立新帳號' : '登入遊戲'}
          </h2>
          
          <div className="space-y-4">
            {isRegisterMode && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">玩家姓名</label>
                <div className="relative">
                  <User size={18} className="absolute left-3 top-3.5 text-slate-500" />
                  <input 
                    type="text" 
                    value={userName} 
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-white"
                    placeholder="輸入遊戲內顯示的名稱"
                    maxLength={12}
                  />
                </div>
              </div>
            )}
            
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">電子郵件 (Email)</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-3.5 text-slate-500" />
                <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-white"
                  placeholder="name@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">密碼</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-3.5 text-slate-500" />
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-white"
                  placeholder="輸入 6 碼以上密碼"
                  required
                />
              </div>
            </div>

            {authError && (
              <div className="text-red-400 text-sm font-bold bg-red-500/10 p-3 rounded border border-red-500/30 text-center">
                {authError}
              </div>
            )}

            <button 
              type="submit"
              disabled={isProcessingAuth}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-4 rounded-lg w-full transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-lg mt-2 flex justify-center"
            >
              {isProcessingAuth ? <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div> : (isRegisterMode ? '註冊並登入' : '登入')}
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-slate-400">
            {isRegisterMode ? '已經有帳號了？' : '還沒有帳號嗎？'}
            <button 
              type="button"
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setAuthError('');
              }} 
              className="text-indigo-400 hover:text-indigo-300 font-bold ml-1 transition"
            >
              {isRegisterMode ? '點此登入' : '點此註冊'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // 首頁 (大廳選單)
  if (view === 'home') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center py-6 px-4 font-sans text-white overflow-y-auto">
        <div className="w-full max-w-4xl flex justify-between items-center mb-6 bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-[0_0_20px_rgba(0,0,0,0.3)]">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500/20 p-3 rounded-full text-indigo-400">
              <User size={24} />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-mono">{user?.email}</p>
              <h2 className="text-xl font-bold text-slate-200">{userName}</h2>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="text-xs flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-900/50 px-4 py-2 rounded-lg transition font-bold"
          >
            <LogOut size={14} /> 登出帳號
          </button>
        </div>

        <div className="text-center mb-6 mt-4">
          <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 tracking-tight">角鬥士棋 3D版</h1>
        </div>

        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-4">
          <div className="bg-slate-800 p-6 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] border border-slate-700 h-fit">
            <h2 className="text-xl font-bold mb-4 text-indigo-300">加入或創建房間</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">輸入房間號碼</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={roomId} 
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoinOrCreate(roomId)}
                    className="flex-1 px-3 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition font-mono uppercase text-white tracking-widest text-lg"
                    placeholder="例如: ROOM123"
                  />
                  <button 
                    onClick={() => handleJoinOrCreate(roomId)}
                    disabled={!roomId.trim() || !userName.trim()}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md shrink-0 text-base"
                  >
                    進入
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 p-5 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] border border-slate-700 flex flex-col h-[350px]">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold text-slate-200">公開房間列表</h2>
              <div className="flex items-center gap-2">
                <div className="text-[10px] bg-slate-700 px-2 py-1 rounded text-slate-300">共 {roomsList.length} 個</div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
              {roomsList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <div className="text-3xl mb-1">👻</div>
                  <p className="text-sm">目前沒有房間，趕快建立一個吧！</p>
                </div>
              ) : (
                roomsList.map(room => (
                  <div key={room.id} className="bg-slate-900/80 border border-slate-700 p-2.5 rounded-xl flex justify-between items-center hover:border-indigo-500 transition group">
                    <div>
                      <div className="font-mono text-base font-bold text-indigo-300">{room.id}</div>
                      <div className="text-[10px] text-slate-400 flex gap-2 mt-0.5">
                        <span>狀態: {room.status === 'playing' ? <span className="text-yellow-500">遊戲中</span> : <span className="text-green-500">等待中</span>}</span>
                        <span>| 人數: {room.slots ? room.slots.filter(s => s !== null).length : 0}/4</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleJoinOrCreate(room.id)}
                      className="bg-slate-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"
                    >
                      加入
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <button onClick={() => setIsAdmin(!isAdmin)} className="text-slate-700 hover:text-slate-500 transition">
            <ShieldAlert size={16} />
          </button>
          
          {isAdmin && (
            <div className="bg-red-900/30 border border-red-800 p-3 rounded-xl flex flex-col items-center gap-2">
              <span className="text-red-400 font-bold text-xs">⚠️ 管理員模式已開啟</span>
              <button 
                onClick={handleAdminClearAll}
                disabled={roomsList.length === 0}
                className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 disabled:grayscale"
              >
                <Trash2 size={14} />
                清除所有房間
              </button>
            </div>
          )}
        </div>

        <style dangerouslySetInnerHTML={{__html: `
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        `}} />
      </div>
    );
  }

  if (view === 'lobby' && roomData) {
    const isHost = roomData.host === user.uid; // 判斷房主改回 user.uid
    const allSlotsFilled = roomData.slots.every(s => s !== null);

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center p-4 font-sans text-slate-100 overflow-y-auto">
        <div className="bg-slate-800 p-5 sm:p-6 rounded-2xl shadow-2xl max-w-xl w-full border border-slate-700">
          <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
            <h2 className="text-xl font-bold flex items-center gap-3">
              大廳: <span className="font-mono text-indigo-400">{roomId}</span>
              <button onClick={handleForceSync} className="text-slate-400 hover:text-white transition bg-slate-700 p-1.5 rounded-md" title="重新整理連線">
                <RefreshCw size={14} className={isSyncing ? "animate-spin text-indigo-400" : ""} />
              </button>
            </h2>
            
            {isHost ? (
              <button onClick={handleDeleteRoom} className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/20 rounded-md transition border border-red-900/50">
                <Trash2 size={14} /> 解散房間
              </button>
            ) : (
              <button onClick={handleLeaveRoom} className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-md transition">
                <LogOut size={14} /> 離開房間
              </button>
            )}
          </div>

          <div className="mb-5 bg-blue-900/40 border border-blue-800 p-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={16} />
            <div className="text-xs text-blue-200">
              <p>需要 4 個顏色都有人佔領才能開始。</p>
              <p>若為 2 人遊玩，每人可點擊佔領 2 個顏色 (建議選擇對角線，如紅+黃)。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {COLORS.map((color, idx) => {
              const slot = roomData.slots[idx];
              const isMySlot = slot?.uid === user.uid; // 使用 user.uid 比對
              
              return (
                <div key={idx} className={`p-3 rounded-xl border-2 flex justify-between items-center bg-slate-900/50 ${color.border}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-md ${color.bg} piece-3d`}></div>
                    <span className="font-bold text-sm text-slate-200">{color.name}</span>
                  </div>
                  
                  {slot ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate max-w-[80px]">{slot.name}</span>
                      {isMySlot && (
                        <button onClick={() => handleLeaveSlot(idx)} className="text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded">退出</button>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleClaimSlot(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition piece-3d ${color.bg} hover:brightness-110 active:translate-y-px`}
                    >
                      加入 {color.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-3">
            {isHost ? (
              <>
                <button 
                  onClick={handleStartGame}
                  disabled={!allSlotsFilled}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-2.5 px-6 rounded-full shadow-lg transition disabled:opacity-50 disabled:grayscale flex items-center gap-1.5 text-base w-full sm:w-auto justify-center piece-3d"
                >
                  <Play fill="currentColor" size={16} />
                  開始遊戲
                </button>
                <button onClick={handleRestartRoom} className="text-xs text-yellow-500 hover:text-yellow-400 flex items-center gap-1 mt-2">
                  <RotateCcw size={12} /> 踢除所有人並重置狀態
                </button>
              </>
            ) : (
              <div className="text-center text-slate-400 flex flex-col items-center">
                <div className="animate-pulse mb-1 text-sm">等待房主開始遊戲...</div>
                {!allSlotsFilled && <div className="text-[10px]">等待所有顏色都有玩家加入</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- 遊戲主畫面 ---
  if (view === 'game' && roomData) {
    const isFinished = roomData.status === 'finished';
    const currentScores = calculateScores(); 
    const isHost = roomData.host === user.uid;

    const toggleVibration = () => {
      setVibrationEnabled(!vibrationEnabled);
      if (!vibrationEnabled && navigator.vibrate) navigator.vibrate(40); 
    };

    return (
      <div className="h-screen bg-slate-900 text-slate-100 flex flex-col font-sans overflow-hidden">
        
        <style dangerouslySetInnerHTML={{__html: `
          .piece-3d {
            box-shadow: inset 1px 1px 3px rgba(255,255,255,0.4), inset -1px -1px 3px rgba(0,0,0,0.3), 1px 1px 2px rgba(0,0,0,0.4);
            border: 1px solid rgba(0,0,0,0.1);
          }
          .cell-empty {
            background-color: #334155; 
            box-shadow: inset 1px 1px 3px rgba(0,0,0,0.4);
            border: 1px solid #1e293b;
          }
          .cell-invalid {
            background: repeating-linear-gradient(45deg, #ef4444, #ef4444 6px, #991b1b 6px, #991b1b 12px);
            box-shadow: 0 0 10px rgba(239, 68, 68, 0.8);
            border: 2px solid #7f1d1d;
            animation: pulse-alert 0.8s infinite;
            z-index: 10;
          }
          @keyframes pulse-alert {
            0% { opacity: 0.8; transform: scale(0.95); }
            50% { opacity: 1; transform: scale(1.05); }
            100% { opacity: 0.8; transform: scale(0.95); }
          }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        `}} />

        {/* 頂部導覽列 */}
        <header className="bg-slate-800 p-1.5 sm:p-2 shadow-md flex justify-between items-center z-10 shrink-0 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 hidden sm:block ml-1">BLOKUS</h1>
            <div className="bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-mono text-indigo-300">{roomId}</div>
            
            {/* 強制同步 (重新整理) 按鈕 */}
            <button 
              onClick={handleForceSync} 
              className={`p-1.5 ml-1 rounded-lg transition text-slate-400 hover:text-white hover:bg-slate-700`} 
              title="重新整理連線狀態"
            >
              <RefreshCw size={14} className={isSyncing ? "animate-spin text-indigo-400" : ""} />
            </button>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            {!isFinished && (
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-full pr-3 pl-1 py-0.5 shadow-inner mr-1">
                <div className={`w-3 h-3 rounded-full ${COLORS[roomData.currentTurn].bg} piece-3d`}></div>
                <span className="text-[10px] sm:text-xs font-bold truncate max-w-[60px] sm:max-w-[100px]">
                  {roomData.slots[roomData.currentTurn]?.name} 
                </span>
                {isMyTurn && <span className="ml-1 text-[9px] text-yellow-400 animate-pulse hidden sm:inline">思考中</span>}
              </div>
            )}

            <button onClick={toggleVibration} className={`p-1.5 rounded-lg transition ${vibrationEnabled ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
              {vibrationEnabled ? <Vibrate size={14} /> : <VibrateOff size={14} />}
            </button>

            {isHost && !isFinished && (
              <button onClick={handleForceEndGame} className="p-1.5 text-yellow-500 hover:bg-slate-700 rounded-lg transition" title="強制結算遊戲">
                <StopCircle size={14} />
              </button>
            )}

            <button onClick={handleLeaveRoom} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition" title="離開房間">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* 微型計分板 */}
          <div className="bg-slate-800/90 p-1.5 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-y-auto shrink-0 z-10 border-b lg:border-b-0 lg:border-r border-slate-700 shadow-sm lg:w-36 items-center lg:items-stretch">
            {COLORS.map((c, idx) => {
              const slot = roomData.slots[idx];
              const isActive = roomData.currentTurn === idx && !isFinished;
              const hasSurrendered = roomData.surrendered && roomData.surrendered[idx];
              
              return (
                <div key={idx} className={`px-2 py-1 sm:p-2 rounded-lg border flex-shrink-0 flex lg:flex-col items-center lg:items-start gap-1 lg:gap-1.5 transition-all min-w-[100px] lg:w-full ${isActive ? `${c.border} bg-slate-700 shadow-[0_0_8px_rgba(255,255,255,0.15)]` : hasSurrendered ? 'border-slate-800 bg-slate-900 opacity-40 grayscale' : 'border-slate-700 bg-slate-900/50 opacity-80'}`}>
                  
                  <div className="flex items-center gap-1.5 w-full">
                    <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-[2px] ${c.bg} piece-3d shrink-0`}></div>
                    <span className={`font-bold text-[10px] sm:text-xs truncate w-full ${hasSurrendered ? 'line-through text-slate-500' : 'text-slate-300'}`}>{slot?.name || '無人'}</span>
                  </div>
                  
                  <div className="flex gap-1.5 w-full text-[9px] sm:text-[10px] bg-slate-900/80 px-1 py-0.5 rounded text-slate-400 font-mono items-center justify-between lg:justify-start">
                    <span title="剩餘棋子數">剩:{roomData.piecesLeft[idx]?.length || 0}</span>
                    <span title="目前扣分數" className={`${isActive ? 'text-yellow-400' : 'text-slate-500'}`}>分:-{currentScores[idx]}</span>
                  </div>
                  
                  {hasSurrendered && <div className="hidden lg:block text-[9px] text-red-500 font-bold w-full text-center mt-0.5">已投降</div>}
                </div>
              );
            })}
          </div>

          {/* 中央：棋盤與結算 */}
          <div className="flex-1 flex flex-col items-center justify-center p-1 sm:p-2 overflow-hidden relative">
            
            {isFinished && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
                <div className="bg-slate-800 border-2 border-yellow-500 p-5 rounded-2xl text-center shadow-[0_0_40px_rgba(234,179,8,0.3)] max-w-sm w-full">
                  <h2 className="text-2xl font-black text-yellow-500 mb-5 flex justify-center items-center gap-2"><Trophy size={24} /> 遊戲結算</h2>
                  <div className="space-y-2 mb-5">
                    {currentScores.map((score, idx) => ({ score, idx }))
                      .sort((a, b) => a.score - b.score)
                      .map((item, rank) => (
                      <div key={item.idx} className={`flex justify-between items-center text-sm bg-slate-900 p-2.5 rounded-lg border ${rank === 0 ? 'border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'border-slate-700'} ${(roomData.surrendered && roomData.surrendered[item.idx]) ? 'opacity-60' : ''}`}>
                        <span className="flex items-center gap-2">
                          <span className={`font-black text-lg ${rank === 0 ? 'text-yellow-500' : 'text-slate-500'}`}>#{rank + 1}</span>
                          <div className={`w-3 h-3 rounded-sm piece-3d ${COLORS[item.idx].bg}`}></div> 
                          <span className="font-bold">{COLORS[item.idx].name}</span>
                          {(roomData.surrendered && roomData.surrendered[item.idx]) && <span className="text-[10px] text-red-500 ml-1">(投降)</span>}
                        </span>
                        <span className="font-mono font-bold text-lg text-yellow-400">-{item.score} <span className="text-[10px] text-slate-500">分</span></span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    {isHost && (
                      <button onClick={handleRestartRoom} className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg piece-3d w-full text-sm">
                        返回大廳 (重新開始)
                      </button>
                    )}
                    <button onClick={handleLeaveRoom} className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 px-4 rounded-xl w-full text-sm">
                      離開房間
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3D 棋盤 */}
            <div className="w-full max-w-[98vw] sm:max-w-[550px] lg:max-w-[700px] aspect-square relative select-none">
              <div 
                className="w-full h-full bg-slate-900 rounded p-[2px] shadow-[0_10px_30px_rgba(0,0,0,0.8)] border border-slate-600"
                onMouseLeave={() => setStagingPos(null)}
              >
                <div 
                  className="w-full h-full grid gap-[1px]"
                  style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`, gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)` }}
                >
                  {roomData.board.map((row, y) => 
                    row.map((cellOwner, x) => {
                      let isHovered = false;
                      let hoverValid = false;
                      
                      if (stagingPos && selectedPieceIndex !== null && isMyTurn) {
                        const isPart = activePieceCoords.some(([dy, dx]) => stagingPos.y + dy === y && stagingPos.x + dx === x);
                        if (isPart) {
                          isHovered = true;
                          hoverValid = isMoveValid;
                        }
                      }

                      let cellClasses = "cell-empty"; 
                      let innerElement = null;
                      
                      if (cellOwner !== null) {
                        cellClasses = `piece-3d ${COLORS[cellOwner].bg}`;
                      } else if (isHovered) {
                        if (hoverValid) {
                          cellClasses = `piece-3d ${COLORS[currentColor].bg} opacity-70 scale-95 transition-transform`;
                        } else {
                          cellClasses = `cell-invalid scale-110`;
                        }
                      } else {
                        if (y === 0 && x === 0) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" />;
                        else if (y === 0 && x === 19) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" />;
                        else if (y === 19 && x === 19) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-yellow-500/60 shadow-[0_0_8px_rgba(234,179,8,0.8)] animate-pulse" />;
                        else if (y === 19 && x === 0) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-green-500/60 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse" />;
                      }

                      return (
                        <div 
                          key={`${y}-${x}`}
                          className={`w-full h-full rounded-[1px] ${cellClasses} cursor-pointer flex items-center justify-center`}
                          onClick={() => handleBoardClick(y, x)}
                          onMouseEnter={() => {
                            if (isMyTurn && selectedPieceIndex !== null && window.matchMedia('(hover: hover)').matches) {
                              setStagingPos({y, x});
                            }
                          }}
                        >
                          {innerElement}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {isMyTurn && stagingPos && selectedPieceIndex !== null && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none w-full flex justify-center">
                  <button
                    onClick={handleConfirmMove}
                    disabled={!isMoveValid}
                    className={`pointer-events-auto flex items-center gap-1.5 px-6 py-3 rounded-full font-black text-base shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-all ${isMoveValid ? 'bg-green-500 hover:bg-green-400 text-white scale-100 piece-3d' : 'opacity-0 scale-50'}`}
                  >
                    <Check size={20} />
                    確認放置
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* 方塊選擇盤 */}
          <div className="h-[32vh] min-h-[200px] lg:h-auto lg:w-[320px] xl:w-[380px] bg-slate-800 p-2 sm:p-3 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] flex flex-col z-20 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700">
            {!isFinished ? (
              isMyTurn ? (
                <>
                  <div className="flex justify-between items-center mb-1.5 shrink-0">
                    <h3 className="font-bold text-xs sm:text-sm text-white flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${COLORS[currentColor].bg} piece-3d`}></div>
                      你的方塊
                    </h3>
                    <div className="flex gap-1.5">
                      <button 
                        onClick={handleSurrender}
                        className={`text-[10px] sm:text-xs flex items-center gap-0.5 px-2 py-1 rounded border shadow-sm transition ${confirmSurrender ? 'bg-red-600 border-red-500 text-white font-bold animate-pulse' : 'bg-slate-800 border-red-900 text-red-400 hover:bg-slate-700'}`}
                      >
                        <Flag size={12} /> {confirmSurrender ? '確定?' : '投降'}
                      </button>
                      <button 
                        onClick={handlePassTurn}
                        className="text-[10px] sm:text-xs flex items-center gap-0.5 bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded border border-slate-600 shadow-sm transition"
                      >
                        <SkipForward size={12} /> 略過
                      </button>
                    </div>
                  </div>
                  
                  {/* 控制區 */}
                  {selectedPieceIndex !== null && (
                    <div className="flex justify-center gap-2 mb-1.5 shrink-0">
                      <button 
                        onClick={() => setTransform(prev => ({ ...prev, rot: (prev.rot + 1) % 4 }))}
                        className="flex-1 flex flex-col items-center gap-0.5 bg-slate-900/50 hover:bg-slate-700 py-1.5 rounded-lg border border-slate-600 transition"
                      >
                        <RotateCw size={16} className="text-indigo-400" />
                        <span className="text-[9px] text-slate-300">旋轉</span>
                      </button>
                      <button 
                        onClick={() => setTransform(prev => ({ ...prev, flipX: !prev.flipX }))}
                        className="flex-1 flex flex-col items-center gap-0.5 bg-slate-900/50 hover:bg-slate-700 py-1.5 rounded-lg border border-slate-600 transition"
                      >
                        <FlipHorizontal size={16} className="text-purple-400" />
                        <span className="text-[9px] text-slate-300">翻轉</span>
                      </button>
                    </div>
                  )}

                  {/* 棋子庫 */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 bg-slate-900/30 rounded-lg border border-slate-700/50">
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-center lg:justify-start">
                      {roomData.piecesLeft[currentColor].map((pieceIdx) => (
                        <MiniPiece 
                          key={pieceIdx}
                          coords={pieceIdx === selectedPieceIndex ? activePieceCoords : INITIAL_PIECES[pieceIdx]}
                          colorClass={COLORS[currentColor].bg}
                          isSelected={selectedPieceIndex === pieceIdx}
                          onClick={() => {
                            if (selectedPieceIndex === pieceIdx) {
                              setSelectedPieceIndex(null);
                              setStagingPos(null);
                            } else {
                              setSelectedPieceIndex(pieceIdx);
                              setTransform({ rot: 0, flipX: false });
                              setStagingPos(null);
                            }
                          }}
                        />
                      ))}
                      {roomData.piecesLeft[currentColor].length === 0 && (
                        <div className="text-center text-slate-400 mt-4 w-full text-xs">你已用完所有棋子！</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                  <div className="relative mb-3">
                    <div className={`absolute inset-0 rounded-full blur-lg opacity-40 ${COLORS[roomData.currentTurn].bg}`}></div>
                    <div className="animate-spin relative rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                  </div>
                  <span className="text-xs font-bold">等待 {roomData.slots[roomData.currentTurn]?.name} 下棋...</span>
                </div>
              )
            ) : null}
          </div>

        </div>
      </div>
    );
  }

  return null;
}