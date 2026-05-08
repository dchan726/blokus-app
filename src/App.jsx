import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  getDoc 
} from 'firebase/firestore';
import { RotateCw, FlipHorizontal, Check, Users, AlertCircle, Play, SkipForward, LogOut, RotateCcw } from 'lucide-react';

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

// 定義 21 個標準 Blokus 棋子的形狀
const PIECE_SHAPES_STR = [
  ["X"], // 1
  ["XX"], // 2
  ["XXX"], // 3
  ["XX", "X "], // 4
  ["XXXX"], // 5
  ["XXX", "X  "], // 6
  ["XXX", " X "], // 7
  ["XX", "XX"], // 8
  ["XX ", " XX"], // 9
  ["XXXXX"], // 10
  ["XXXX", "X   "], // 11
  ["XXXX", " X  "], // 12
  ["XXX", "XX "], // 13
  ["XXX", "X X"], // 14
  ["XXX", "X  ", "X  "], // 15
  ["XX ", " XX", "  X"], // 16
  [" XX", "XX ", " X "], // 17
  ["XX ", " X ", " XX"], // 18
  ["XXX", " X ", " X "], // 19
  [" X ", "XXX", " X "], // 20
  ["XXX ", "  XX"] // 21
];

// 將字串形狀轉換為座標陣列 [y, x]
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

// 繪製迷你的棋子圖示 (加入 3D CSS class)
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
                className={`w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 ${isFilled ? `${colorClass} piece-3d` : 'bg-transparent'}`} 
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
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(null);
  const [appId, setAppId] = useState('blokus-custom');
  
  const [roomId, setRoomId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [userName, setUserName] = useState('');
  const [view, setView] = useState('home');

  const [selectedPieceIndex, setSelectedPieceIndex] = useState(null);
  const [transform, setTransform] = useState({ rot: 0, flipX: false });
  const [stagingPos, setStagingPos] = useState(null);

  // 初始化 Firebase
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const firestore = getFirestore(app);
        setDb(firestore);

        // 強制使用匿名登入，避免跨專案 Custom Token 衝突
        await signInAnonymously(auth);

        onAuthStateChanged(auth, (u) => {
          setUser(u);
          if (u && !userName) {
            setUserName(`玩家_${u.uid.substring(0, 4)}`);
          }
        });
      } catch (err) {
        console.error("Firebase 初始化失敗:", err);
      }
    };
    initFirebase();
  }, []);

  // 監聽房間資料
  useEffect(() => {
    if (!user || !db || !roomId || view === 'home') return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        // 解析 JSON 字串為陣列
        if (data.board && typeof data.board === 'string') data.board = JSON.parse(data.board);
        if (data.piecesLeft && typeof data.piecesLeft === 'string') data.piecesLeft = JSON.parse(data.piecesLeft);
        setRoomData(data);
      } else {
        setRoomData(null);
        if (view !== 'home') setView('home'); // 房間被刪除時回到首頁
      }
    }, (err) => {
      console.error("讀取房間資料失敗:", err);
    });

    return () => unsubscribe();
  }, [user, db, roomId, view, appId]);

  // 重置本地選擇狀態
  useEffect(() => {
    setSelectedPieceIndex(null);
    setStagingPos(null);
    setTransform({ rot: 0, flipX: false });
  }, [roomData?.currentTurn]);


  // 建立/加入房間
  const handleJoinOrCreate = async () => {
    if (!roomId.trim() || !user) return;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    const snapshot = await getDoc(roomRef);

    if (!snapshot.exists()) {
      // 創建新房間時，將多維陣列轉換為 JSON 字串
      const initialBoard = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
      const initialPieces = Array(4).fill().map(() => Array.from({ length: 21 }, (_, i) => i));

      const newRoom = {
        status: 'lobby',
        host: user.uid,
        slots: [null, null, null, null],
        board: JSON.stringify(initialBoard),
        currentTurn: 0,
        piecesLeft: JSON.stringify(initialPieces),
        passCount: 0,
        createdAt: Date.now()
      };
      await setDoc(roomRef, newRoom);
    }
    setView('lobby');
  };

  // 離開房間
  const handleLeaveRoom = () => {
    setView('home');
    setRoomId('');
  };

  // 重置/清除房間 (房主專用)
  const handleRestartRoom = async () => {
    if (!roomData) return;
    const initialBoard = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
    const initialPieces = Array(4).fill().map(() => Array.from({ length: 21 }, (_, i) => i));
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      status: 'lobby',
      board: JSON.stringify(initialBoard),
      currentTurn: 0,
      piecesLeft: JSON.stringify(initialPieces),
      passCount: 0
    });
    setView('lobby');
  };

  // 佔領顏色槽位
  const handleClaimSlot = async (slotIndex) => {
    if (!roomData || roomData.status !== 'lobby') return;
    const newSlots = [...roomData.slots];
    newSlots[slotIndex] = { uid: user.uid, name: userName };
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, { slots: newSlots });
  };

  // 離開顏色槽位
  const handleLeaveSlot = async (slotIndex) => {
    if (!roomData || roomData.status !== 'lobby') return;
    const newSlots = [...roomData.slots];
    if (newSlots[slotIndex]?.uid === user.uid) {
      newSlots[slotIndex] = null;
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
      await updateDoc(roomRef, { slots: newSlots });
    }
  };

  // 開始遊戲
  const handleStartGame = async () => {
    if (!roomData || roomData.slots.some(s => s === null)) {
      alert("請確保所有 4 個顏色都有玩家加入！");
      return;
    }
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, { 
      status: 'playing',
      currentTurn: 0,
      passCount: 0
    });
    setView('game');
  };

  // 當前玩家與回合判斷
  const isMyTurn = roomData && 
                   roomData.status === 'playing' && 
                   roomData.slots[roomData.currentTurn]?.uid === user?.uid;
  const currentColor = roomData?.currentTurn ?? 0;

  // 計算變換後的棋子座標
  const activePieceCoords = useMemo(() => {
    if (selectedPieceIndex === null) return [];
    return transformPiece(INITIAL_PIECES[selectedPieceIndex], transform.rot, transform.flipX);
  }, [selectedPieceIndex, transform]);

  // 判斷暫存位置是否合法
  const isMoveValid = useMemo(() => {
    if (!stagingPos || !roomData || selectedPieceIndex === null) return false;
    return validateMove(roomData.board, currentColor, activePieceCoords, stagingPos.y, stagingPos.x);
  }, [stagingPos, roomData, activePieceCoords, currentColor, selectedPieceIndex]);

  // 點擊棋盤
  const handleBoardClick = (y, x) => {
    if (!isMyTurn || selectedPieceIndex === null) return;
    setStagingPos({ y, x });
  };

  // 確認放置
  const handleConfirmMove = async () => {
    if (!isMyTurn || !isMoveValid || !stagingPos || selectedPieceIndex === null) return;

    // 深拷貝並應用變更
    const newBoard = roomData.board.map(row => [...row]);
    activePieceCoords.forEach(([dy, dx]) => {
      newBoard[stagingPos.y + dy][stagingPos.x + dx] = currentColor;
    });

    const newPiecesLeft = roomData.piecesLeft.map(arr => [...arr]);
    newPiecesLeft[currentColor] = newPiecesLeft[currentColor].filter(idx => idx !== selectedPieceIndex);

    let nextTurn = (currentColor + 1) % 4;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      board: JSON.stringify(newBoard),
      piecesLeft: JSON.stringify(newPiecesLeft),
      currentTurn: nextTurn,
      passCount: 0
    });
  };

  // 跳過回合
  const handlePassTurn = async () => {
    if (!isMyTurn) return;
    
    const newPassCount = roomData.passCount + 1;
    let nextStatus = roomData.status;
    if (newPassCount >= 4) {
      nextStatus = 'finished';
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', roomId);
    await updateDoc(roomRef, {
      currentTurn: (currentColor + 1) % 4,
      passCount: newPassCount,
      status: nextStatus
    });
  };

  // 計算分數
  const calculateScores = () => {
    if (!roomData || !roomData.piecesLeft) return [];
    return roomData.piecesLeft.map(pieces => {
      let squares = 0;
      pieces.forEach(pIdx => {
        squares += INITIAL_PIECES[pIdx].length;
      });
      return squares;
    });
  };


  // --- 畫面渲染 ---

  if (!user || !db) {
    return <div className="flex items-center justify-center h-screen bg-slate-900"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div></div>;
  }

  if (view === 'home') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans text-white">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] max-w-md w-full border border-slate-700">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mb-2 tracking-tight">角鬥士棋 3D版</h1>
            <p className="text-slate-400">連線 2-4 人對戰</p>
          </div>
          
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">您的玩家名稱</label>
              <input 
                type="text" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-white"
                placeholder="輸入您的名稱"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">房間號碼</label>
              <input 
                type="text" 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition font-mono uppercase text-white tracking-widest text-lg"
                placeholder="例如: ROOM123"
              />
            </div>
            <button 
              onClick={handleJoinOrCreate}
              disabled={!roomId.trim() || !userName.trim()}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg"
            >
              <Users size={20} />
              進入遊戲大廳
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'lobby' && roomData) {
    const isHost = roomData.host === user.uid;
    const allSlotsFilled = roomData.slots.every(s => s !== null);

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center p-4 sm:p-8 font-sans text-slate-100">
        <div className="bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-700">
          <div className="flex justify-between items-center mb-8 border-b border-slate-700 pb-4">
            <h2 className="text-2xl font-bold">房間: <span className="font-mono text-indigo-400">{roomId}</span></h2>
            <button onClick={handleLeaveRoom} className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition">
              <LogOut size={16} /> 離開房間
            </button>
          </div>

          <div className="mb-6 bg-blue-900/40 border border-blue-800 p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-blue-200">
              <p>需要 4 個顏色都準備好才能開始。</p>
              <p>若為 2 人遊玩，每人可以點擊「加入」佔領 2 個顏色 (建議選擇對角線顏色，如紅+黃)。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {COLORS.map((color, idx) => {
              const slot = roomData.slots[idx];
              const isMySlot = slot?.uid === user.uid;
              
              return (
                <div key={idx} className={`p-4 rounded-xl border-2 flex justify-between items-center bg-slate-900/50 ${color.border}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-md ${color.bg} piece-3d`}></div>
                    <span className="font-bold text-slate-200">{color.name}</span>
                  </div>
                  
                  {slot ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{slot.name}</span>
                      {isMySlot && (
                        <button onClick={() => handleLeaveSlot(idx)} className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded">退出</button>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleClaimSlot(idx)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition piece-3d ${color.bg} hover:brightness-110 active:translate-y-px`}
                    >
                      加入 {color.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-4">
            {isHost ? (
              <>
                <button 
                  onClick={handleStartGame}
                  disabled={!allSlotsFilled}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transition disabled:opacity-50 disabled:grayscale flex items-center gap-2 text-lg w-full sm:w-auto justify-center piece-3d"
                >
                  <Play fill="currentColor" size={20} />
                  開始遊戲
                </button>
                <button onClick={handleRestartRoom} className="text-sm text-slate-400 hover:text-white flex items-center gap-1">
                  <RotateCcw size={14} /> 清除/重置房間狀態
                </button>
              </>
            ) : (
              <div className="text-center text-slate-400 flex flex-col items-center">
                <div className="animate-pulse mb-2 text-lg">等待房主開始遊戲...</div>
                {!allSlotsFilled && <div className="text-sm">等待所有顏色都有玩家加入</div>}
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
    const scores = isFinished ? calculateScores() : null;
    const isHost = roomData.host === user.uid;

    return (
      <div className="h-screen bg-slate-900 text-slate-100 flex flex-col font-sans overflow-hidden">
        
        {/* 定義強化的 3D 與警示 CSS */}
        <style dangerouslySetInnerHTML={{__html: `
          .piece-3d {
            box-shadow: inset 2px 2px 4px rgba(255,255,255,0.4), inset -2px -2px 4px rgba(0,0,0,0.3), 1px 1px 3px rgba(0,0,0,0.4);
            border: 1px solid rgba(0,0,0,0.1);
          }
          .cell-empty {
            background-color: #334155; /* slate-700 */
            box-shadow: inset 1px 1px 4px rgba(0,0,0,0.4);
            border: 1px solid #1e293b; /* slate-800 */
          }
          .cell-invalid {
            background: repeating-linear-gradient(45deg, #ef4444, #ef4444 8px, #991b1b 8px, #991b1b 16px);
            box-shadow: 0 0 15px rgba(239, 68, 68, 0.8);
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

        {/* 頂部資訊列 */}
        <header className="bg-slate-800 p-3 shadow-[0_4px_20px_rgba(0,0,0,0.4)] flex justify-between items-center z-10 shrink-0 border-b border-slate-700">
          <div className="flex items-center gap-2 sm:gap-4">
            <h1 className="text-lg font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 hidden sm:block">BLOKUS</h1>
            <div className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-xs sm:text-sm font-mono text-indigo-300">{roomId}</div>
          </div>
          
          <div className="flex items-center gap-3">
            {!isFinished && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-full pr-4 pl-1 py-1 shadow-inner">
                <div className={`w-4 h-4 rounded-full ${COLORS[roomData.currentTurn].bg} piece-3d`}></div>
                <span className="text-xs sm:text-sm font-bold">
                  {roomData.slots[roomData.currentTurn]?.name} 
                  {isMyTurn && <span className="ml-2 text-yellow-400 animate-pulse">思考中...</span>}
                </span>
              </div>
            )}
            <button onClick={handleLeaveRoom} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition" title="離開房間">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* 左側/頂部：玩家狀態列表 */}
          <div className="bg-slate-800/80 p-2 sm:p-4 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto shrink-0 z-10 border-b lg:border-b-0 lg:border-r border-slate-700 shadow-xl">
            {COLORS.map((c, idx) => {
              const slot = roomData.slots[idx];
              const isActive = roomData.currentTurn === idx && !isFinished;
              return (
                <div key={idx} className={`p-2 sm:p-3 rounded-xl border-2 flex-shrink-0 lg:flex-shrink flex lg:flex-col items-center lg:items-start gap-1 sm:gap-2 transition-all ${isActive ? `${c.border} bg-slate-700 shadow-[0_0_15px_rgba(255,255,255,0.15)] scale-105` : 'border-slate-700 bg-slate-900/50 opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded ${c.bg} piece-3d`}></div>
                    <span className="font-bold text-xs sm:text-sm truncate max-w-[80px] lg:max-w-[120px]">{slot?.name || '無人'}</span>
                  </div>
                  <div className="text-[10px] sm:text-xs text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded-full">
                    剩餘: {roomData.piecesLeft[idx]?.length || 0}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 中央：棋盤與遊戲結束畫面 */}
          <div className="flex-1 flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden relative">
            
            {isFinished && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
                <div className="bg-slate-800 border-2 border-yellow-500 p-6 rounded-2xl text-center shadow-[0_0_50px_rgba(234,179,8,0.3)] max-w-sm w-full">
                  <h2 className="text-3xl font-black text-yellow-500 mb-6">遊戲結束！</h2>
                  <div className="space-y-3 mb-6">
                    {scores.map((score, idx) => (
                      <div key={idx} className="flex justify-between items-center text-lg bg-slate-900 p-2 rounded-lg border border-slate-700">
                        <span className="flex items-center gap-2"><div className={`w-4 h-4 rounded piece-3d ${COLORS[idx].bg}`}></div> <span className="font-bold">{COLORS[idx].name}</span></span>
                        <span className="font-mono font-bold text-xl">{score} 分</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mb-6">分數為剩餘的方塊總格數，分數越低越好。</p>
                  
                  <div className="flex flex-col gap-3">
                    {isHost && (
                      <button onClick={handleRestartRoom} className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg piece-3d w-full">
                        再來一局
                      </button>
                    )}
                    <button onClick={handleLeaveRoom} className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-xl w-full">
                      返回大廳
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 響應式 3D 棋盤 */}
            <div className="w-full max-w-[95vw] sm:max-w-[500px] lg:max-w-[600px] aspect-square relative select-none">
              <div 
                className="w-full h-full bg-slate-900 rounded-lg p-[3px] shadow-[0_10px_40px_rgba(0,0,0,0.8)] border border-slate-600"
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

                      // 決定格子的 CSS 樣式
                      let cellClasses = "cell-empty"; 
                      
                      if (cellOwner !== null) {
                        cellClasses = `piece-3d ${COLORS[cellOwner].bg}`;
                      } else if (isHovered) {
                        if (hoverValid) {
                          cellClasses = `piece-3d ${COLORS[currentColor].bg} opacity-70 scale-95 transition-transform`;
                        } else {
                          // 強烈違規顏色提示
                          cellClasses = `cell-invalid scale-110`;
                        }
                      } else {
                        // 標記角落起點
                        if (y === 0 && x === 0) cellClasses += " shadow-[inset_6px_6px_0_rgba(239,68,68,0.4)]";
                        else if (y === 0 && x === 19) cellClasses += " shadow-[inset_-6px_6px_0_rgba(59,130,246,0.4)]";
                        else if (y === 19 && x === 19) cellClasses += " shadow-[inset_-6px_-6px_0_rgba(234,179,8,0.4)]";
                        else if (y === 19 && x === 0) cellClasses += " shadow-[inset_6px_-6px_0_rgba(34,197,94,0.4)]";
                      }

                      return (
                        <div 
                          key={`${y}-${x}`}
                          className={`w-full h-full rounded-[1px] ${cellClasses} cursor-pointer`}
                          onClick={() => handleBoardClick(y, x)}
                          onMouseEnter={() => {
                            if (isMyTurn && selectedPieceIndex !== null && window.matchMedia('(hover: hover)').matches) {
                              setStagingPos({y, x});
                            }
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {/* 確認放置按鈕 (覆蓋在棋盤上方) */}
              {isMyTurn && stagingPos && selectedPieceIndex !== null && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none w-full flex justify-center">
                  <button
                    onClick={handleConfirmMove}
                    disabled={!isMoveValid}
                    className={`pointer-events-auto flex items-center gap-2 px-8 py-4 rounded-full font-black text-lg shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all ${isMoveValid ? 'bg-green-500 hover:bg-green-400 text-white scale-100 piece-3d' : 'opacity-0 scale-50'}`}
                  >
                    <Check size={28} />
                    確認放置
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* 右側/底部：當前回合玩家的操作與棋子庫 */}
          <div className="h-48 lg:h-auto lg:w-80 bg-slate-800 p-3 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] flex flex-col z-20 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700">
            {!isFinished ? (
              isMyTurn ? (
                <>
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${COLORS[currentColor].bg} piece-3d`}></div>
                      點選形狀並翻轉
                    </h3>
                    <button 
                      onClick={handlePassTurn}
                      className="text-xs sm:text-sm flex items-center gap-1 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg border border-slate-600 shadow-sm"
                    >
                      <SkipForward size={14} /> 放棄回合
                    </button>
                  </div>
                  
                  {/* 控制區 */}
                  {selectedPieceIndex !== null && (
                    <div className="flex justify-center gap-4 mb-2 shrink-0">
                      <button 
                        onClick={() => setTransform(prev => ({ ...prev, rot: (prev.rot + 1) % 4 }))}
                        className="flex-1 flex flex-col items-center gap-1 bg-slate-900/50 hover:bg-slate-700 p-2 rounded-lg border border-slate-600 transition"
                      >
                        <RotateCw size={20} className="text-indigo-400" />
                        <span className="text-[10px] text-slate-300">旋轉</span>
                      </button>
                      <button 
                        onClick={() => setTransform(prev => ({ ...prev, flipX: !prev.flipX }))}
                        className="flex-1 flex flex-col items-center gap-1 bg-slate-900/50 hover:bg-slate-700 p-2 rounded-lg border border-slate-600 transition"
                      >
                        <FlipHorizontal size={20} className="text-purple-400" />
                        <span className="text-[10px] text-slate-300">翻轉</span>
                      </button>
                    </div>
                  )}

                  {/* 棋子庫 */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-1 bg-slate-900/30 rounded-xl border border-slate-700/50">
                    <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
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
                        <div className="text-center text-slate-400 mt-6 w-full text-sm">你已用完所有棋子！</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center p-4">
                  <div className="relative mb-4">
                    <div className={`absolute inset-0 rounded-full blur-xl opacity-50 ${COLORS[roomData.currentTurn].bg}`}></div>
                    <div className="animate-spin relative rounded-full h-10 w-10 border-t-2 border-b-2 border-white"></div>
                  </div>
                  <span className="text-sm font-bold">對手 {roomData.slots[roomData.currentTurn]?.name} 思考中...</span>
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