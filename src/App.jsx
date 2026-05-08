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
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import { RotateCw, FlipHorizontal, Check, Users, AlertCircle, Play, SkipForward, LogOut, RotateCcw, Flag, Trash2, ShieldAlert } from 'lucide-react';

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
  const [roomsList, setRoomsList] = useState([]);
  const [userName, setUserName] = useState('');
  const [view, setView] = useState('home');

  const [selectedPieceIndex, setSelectedPieceIndex] = useState(null);
  const [transform, setTransform] = useState({ rot: 0, flipX: false });
  const [stagingPos, setStagingPos] = useState(null);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // 初始化 Firebase
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const firestore = getFirestore(app);
        setDb(firestore);

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

  // 監聽所有房間列表 (用於首頁大廳)
  useEffect(() => {
    if (!db || view !== 'home') return;
    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms');
    const unsubscribe = onSnapshot(roomsRef, (snapshot) => {
      const list = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        list.push({ id: doc.id, ...data });
      });
      // 依據建立時間排序，新的在前面
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setRoomsList(list);
    });
    return () => unsubscribe();
  }, [db, view, appId]);

  // 監聽單一房間資料
  useEffect(() => {
    if (!user || !db || !roomId || view === 'home') return;

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

  // 同步房間狀態到視圖 (修復重新開始沒反應的問題)
  useEffect(() => {
    if (!roomData) return;
    // 如果房間回到大廳狀態，且目前在遊戲畫面，則強制切回大廳
    if (roomData.status === 'lobby' && view === 'game') {
      setView('lobby');
    } 
    // 如果房間開始遊戲，且目前在大廳，則強制切回遊戲
    else if (roomData.status === 'playing' && view === 'lobby') {
      setView('game');
    }
  }, [roomData?.status, view]);

  // 自動跳過已投降的玩家回合
  useEffect(() => {
    if (!roomData || roomData.status !== 'playing' || !db || !roomId) return;
    
    // 只有房主負責執行自動跳過，避免多個客戶端重複發送更新
    if (roomData.host === user?.uid) {
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
        }, 800); // 稍微延遲，讓畫面能看出輪轉
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


  // 建立/加入房間
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
        host: user.uid,
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

  // 管理員清除所有房間
  const handleAdminClearAll = async () => {
    if (!isAdmin || !db) return;
    if (window.confirm("確定要清除伺服器上所有的房間嗎？這將會中斷正在進行的遊戲。")) {
      for (const room of roomsList) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'blokus_rooms', room.id));
      }
    }
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
      passCount: 0,
      surrendered: [false, false, false, false]
    });
  };

  // 佔領/離開顏色槽位
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
      passCount: 0,
      surrendered: [false, false, false, false]
    });
  };

  // 當前玩家與回合判斷
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
      <div className="min-h-screen bg-slate-900 flex flex-col items-center py-10 px-4 font-sans text-white overflow-y-auto">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mb-2 tracking-tight">角鬥士棋 3D版</h1>
          <p className="text-slate-400">多人線上連線對戰</p>
        </div>

        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6">
          {/* 左側：加入/建立房間 */}
          <div className="bg-slate-800 p-8 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-slate-700 h-fit">
            <h2 className="text-2xl font-bold mb-6 text-indigo-300">加入或創建房間</h2>
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
                <label className="block text-sm font-medium text-slate-300 mb-1">輸入房間號碼</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={roomId} 
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition font-mono uppercase text-white tracking-widest text-lg"
                    placeholder="例如: ROOM123"
                  />
                  <button 
                    onClick={() => handleJoinOrCreate(roomId)}
                    disabled={!roomId.trim() || !userName.trim()}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shrink-0"
                  >
                    進入
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 右側：公開房間列表 */}
          <div className="bg-slate-800 p-6 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-slate-700 flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-200">公開房間列表</h2>
              <div className="text-xs bg-slate-700 px-2 py-1 rounded text-slate-300">共 {roomsList.length} 個</div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {roomsList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <div className="text-4xl mb-2">👻</div>
                  <p>目前沒有房間，趕快建立一個吧！</p>
                </div>
              ) : (
                roomsList.map(room => (
                  <div key={room.id} className="bg-slate-900/80 border border-slate-700 p-3 rounded-xl flex justify-between items-center hover:border-indigo-500 transition group">
                    <div>
                      <div className="font-mono text-lg font-bold text-indigo-300">{room.id}</div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-2">
                        <span>狀態: {room.status === 'playing' ? <span className="text-yellow-500">遊戲中</span> : <span className="text-green-500">等待中</span>}</span>
                        <span>| 人數: {room.slots ? room.slots.filter(s => s !== null).length : 0}/4</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleJoinOrCreate(room.id)}
                      disabled={!userName.trim()}
                      className="bg-slate-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition disabled:opacity-50"
                    >
                      加入
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 底部隱藏的管理員功能 */}
        <div className="mt-12 flex flex-col items-center gap-4">
          <button onClick={() => setIsAdmin(!isAdmin)} className="text-slate-700 hover:text-slate-500 transition">
            <ShieldAlert size={20} />
          </button>
          
          {isAdmin && (
            <div className="bg-red-900/30 border border-red-800 p-4 rounded-xl flex flex-col items-center gap-3">
              <span className="text-red-400 font-bold text-sm">⚠️ 管理員模式已開啟</span>
              <button 
                onClick={handleAdminClearAll}
                disabled={roomsList.length === 0}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition disabled:opacity-50 disabled:grayscale"
              >
                <Trash2 size={16} />
                清除伺服器上所有房間
              </button>
            </div>
          )}
        </div>

        {/* 全域 CSS */}
        <style dangerouslySetInnerHTML={{__html: `
          .custom-scrollbar::-webkit-scrollbar { width: 6px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        `}} />
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
            <h2 className="text-2xl font-bold">遊戲大廳: <span className="font-mono text-indigo-400">{roomId}</span></h2>
            <button onClick={handleLeaveRoom} className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition">
              <LogOut size={16} /> 離開房間
            </button>
          </div>

          <div className="mb-6 bg-blue-900/40 border border-blue-800 p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-blue-200">
              <p>需要 4 個顏色都有人佔領才能開始。</p>
              <p>若為 2 人遊玩，每人可點擊佔領 2 個顏色 (建議選擇對角線顏色，如紅+黃)。</p>
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
                <button onClick={handleRestartRoom} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 mt-4">
                  <RotateCcw size={14} /> 重置房間狀態
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
            background-color: #334155; 
            box-shadow: inset 1px 1px 4px rgba(0,0,0,0.4);
            border: 1px solid #1e293b;
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
              const hasSurrendered = roomData.surrendered && roomData.surrendered[idx];
              
              return (
                <div key={idx} className={`p-2 sm:p-3 rounded-xl border-2 flex-shrink-0 lg:flex-shrink flex lg:flex-col items-center lg:items-start gap-1 sm:gap-2 transition-all ${isActive ? `${c.border} bg-slate-700 shadow-[0_0_15px_rgba(255,255,255,0.15)] scale-105` : hasSurrendered ? 'border-slate-800 bg-slate-900 opacity-40 grayscale' : 'border-slate-700 bg-slate-900/50 opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded ${c.bg} piece-3d`}></div>
                    <span className={`font-bold text-xs sm:text-sm truncate max-w-[80px] lg:max-w-[120px] ${hasSurrendered ? 'line-through' : ''}`}>{slot?.name || '無人'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] sm:text-xs text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded-full">
                      剩餘: {roomData.piecesLeft[idx]?.length || 0}
                    </div>
                    {hasSurrendered && <span className="text-[10px] text-red-500 font-bold border border-red-500 px-1 rounded">投降</span>}
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
                      <div key={idx} className={`flex justify-between items-center text-lg bg-slate-900 p-2 rounded-lg border border-slate-700 ${(roomData.surrendered && roomData.surrendered[idx]) ? 'opacity-60' : ''}`}>
                        <span className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded piece-3d ${COLORS[idx].bg}`}></div> 
                          <span className="font-bold">{COLORS[idx].name}</span>
                          {(roomData.surrendered && roomData.surrendered[idx]) && <span className="text-xs text-red-500 ml-1">(投降)</span>}
                        </span>
                        <span className="font-mono font-bold text-xl">{score} 分</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mb-6">分數為剩餘的方塊總格數，分數越低越好。</p>
                  
                  <div className="flex flex-col gap-3">
                    {isHost && (
                      <button onClick={handleRestartRoom} className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg piece-3d w-full">
                        返回大廳 (重新開始)
                      </button>
                    )}
                    <button onClick={handleLeaveRoom} className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-xl w-full">
                      離開房間
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
                        // 在四個角落顯示起始顏色的圓點標示
                        if (y === 0 && x === 0) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-red-500/60 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse" />;
                        else if (y === 0 && x === 19) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />;
                        else if (y === 19 && x === 19) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-yellow-500/60 shadow-[0_0_10px_rgba(234,179,8,0.8)] animate-pulse" />;
                        else if (y === 19 && x === 0) innerElement = <div className="w-1/2 h-1/2 rounded-full bg-green-500/60 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse" />;
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

              {/* 確認放置按鈕 */}
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
          <div className="h-[220px] lg:h-auto lg:w-80 bg-slate-800 p-3 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] flex flex-col z-20 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700">
            {!isFinished ? (
              isMyTurn ? (
                <>
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${COLORS[currentColor].bg} piece-3d`}></div>
                      你的回合
                    </h3>
                    <div className="flex gap-2">
                      {/* 投降按鈕 */}
                      <button 
                        onClick={handleSurrender}
                        className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg border shadow-sm transition ${confirmSurrender ? 'bg-red-600 border-red-500 text-white font-bold animate-pulse' : 'bg-slate-800 border-red-900 text-red-400 hover:bg-slate-700'}`}
                      >
                        <Flag size={14} /> {confirmSurrender ? '確定投降?' : '投降'}
                      </button>
                      
                      {/* 放棄回合按鈕 */}
                      <button 
                        onClick={handlePassTurn}
                        className="text-xs flex items-center gap-1 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg border border-slate-600 shadow-sm transition"
                      >
                        <SkipForward size={14} /> 略過回合
                      </button>
                    </div>
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