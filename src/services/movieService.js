import { 
  collection, 
  getDocs, 
  getDoc,
  doc, 
  setDoc,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION_NAME = 'movies';
const SETTINGS_COLLECTION = 'settings';
const LAYOUT_DOC_ID = 'homepage_layout';

// Standardized Storage Keys for 210LoliPhim
const STORAGE_KEY = '210loliphim_movies_db';
const LAYOUT_STORAGE_KEY = '210loliphim_homepage_layout';

// Default initial movies used ONLY on very first run if database is completely empty
const DEFAULT_INITIAL_MOVIES = [
  {
    id: 'mock_1',
    title: 'Dune: Hành Tinh Cát 2',
    originalTitle: 'Dune: Part Two',
    poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80',
    quality: '4K UltraHD',
    badge: 'Phim 4K',
    imdb: '8.6',
    year: '2024',
    episodes: '24/24',
    ageRating: '16+',
    category: 'Top IMDb',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Cuộc hành trình báo thù hoành tráng của Paul Atreides trên hành tinh sa mạc Arrakis.',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mock_2',
    title: 'Deadpool & Wolverine',
    originalTitle: 'Deadpool & Wolverine',
    poster: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80',
    quality: 'Full HD',
    badge: 'Lồng tiếng cực mạnh',
    imdb: '8.1',
    year: '2024',
    episodes: 'Full',
    ageRating: '18+',
    category: 'Lồng tiếng cực mạnh',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Tổ hợp siêu anh hùng bá đạo cùng giải cứu vũ trụ.',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mock_3',
    title: 'Godzilla x Kong: Đế Chế Mới',
    originalTitle: 'Godzilla x Kong: The New Empire',
    poster: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1200&auto=format&fit=crop&q=80',
    quality: '4K',
    badge: 'Thuyết minh',
    imdb: '7.4',
    year: '2024',
    episodes: '1/1',
    ageRating: '13+',
    category: 'Thuyết minh',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Trận chiến hoành tráng giữa các quái thú đại ngàn.',
    createdAt: new Date().toISOString()
  }
];

// Default Layout schema matching 210LoliPhim standard
const DEFAULT_HOMEPAGE_LAYOUT = {
  top10Movies: ['mock_2', 'mock_3', 'mock_1'],
  cinemaMovies: ['mock_3', 'mock_1', 'mock_2'],
  leaderboard: {
    trending: ['mock_2', 'mock_3'],
    favorites: ['mock_1', 'mock_2'],
    newComments: ['mock_2', 'mock_1']
  },
  comingSoon: ['mock_1', 'mock_3'],
  animeVault: ['mock_2']
};

/**
 * Defensive Utility: Strip all undefined values before passing to Firestore
 */
export const sanitizeFirestoreData = (data) => {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => (typeof item === 'object' && item !== null ? sanitizeFirestoreData(item) : item));
  }
  if (typeof data === 'object') {
    const sanitized = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const val = data[key];
        if (val !== undefined) {
          sanitized[key] = (typeof val === 'object' && val !== null) ? sanitizeFirestoreData(val) : val;
        }
      }
    }
    return sanitized;
  }
  return data;
};

/**
 * Timeout Wrapper helper to prevent Firestore SDK hanging when offline
 */
const withTimeout = (promise, ms = 3000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore operation timeout')), ms))
  ]);
};

/**
 * Local cache helpers (for offline fallback & immediate UI responsiveness)
 */
export const getStoredMovies = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('cobephim_movies_db');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Error reading local cache:", e);
  }
  return [...DEFAULT_INITIAL_MOVIES];
};

export const saveStoredMovies = (moviesList) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(moviesList));
  } catch (e) {
    console.warn("Error saving local cache:", e);
  }
};

/**
 * 1. READ ALL MOVIES: Fetch all movies directly from Cloud Firestore
 */
export const getMovies = async () => {
  try {
    const querySnapshot = await withTimeout(getDocs(collection(db, COLLECTION_NAME)), 3500);
    
    if (querySnapshot && !querySnapshot.empty) {
      const fetchedMovies = querySnapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      
      // Sort newest created first in memory
      fetchedMovies.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.updatedAt || 0).getTime();
        const timeB = new Date(b.createdAt || b.updatedAt || 0).getTime();
        return timeB - timeA;
      });

      saveStoredMovies(fetchedMovies);
      return fetchedMovies;
    }
  } catch (error) {
    console.warn("Firestore getMovies fallback to local cache:", error.message);
  }
  return getStoredMovies();
};

/**
 * 2. READ SINGLE MOVIE: Fetch movie by document ID
 */
export const getMovieById = async (id) => {
  if (!id) return null;
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await withTimeout(getDoc(docRef), 2500);
    if (docSnap && docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
  } catch (error) {
    console.warn(`Firestore getMovieById (${id}) fallback:`, error.message);
  }
  const localList = getStoredMovies();
  return localList.find(m => String(m.id) === String(id)) || null;
};

/**
 * 3. CREATE MOVIE: Add a new movie document to Cloud Firestore
 */
export const addMovie = async (movieData) => {
  const payload = sanitizeFirestoreData({
    ...movieData,
    createdAt: movieData.createdAt || new Date().toISOString(),
    status: movieData.status || 'Active'
  });

  let newMovie = { id: `local_${Date.now()}`, ...payload };

  try {
    const docRef = await withTimeout(addDoc(collection(db, COLLECTION_NAME), payload), 3500);
    newMovie = { id: docRef.id, ...payload };
  } catch (e) {
    console.warn("Firestore addDoc fallback to local ID:", e.message);
  }

  const currentList = getStoredMovies();
  const updatedList = [newMovie, ...currentList.filter(m => m.id !== newMovie.id)];
  saveStoredMovies(updatedList);
  return newMovie;
};

/**
 * 4. UPDATE MOVIE: Update movie document in Cloud Firestore
 */
export const updateMovie = async (id, updateData) => {
  if (!id) throw new Error("Missing movie ID for update");

  const payload = sanitizeFirestoreData({
    ...updateData,
    updatedAt: new Date().toISOString()
  });

  // 1. Update Firestore if valid cloud ID
  if (!id.startsWith('mock_') && !id.startsWith('local_')) {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await withTimeout(updateDoc(docRef, payload), 3500);
    } catch (e) {
      console.warn("Firestore updateDoc fallback:", e.message);
    }
  }

  // 2. Update local storage cache
  const currentList = getStoredMovies();
  const updatedList = currentList.map(m => (String(m.id) === String(id) ? { ...m, ...payload, id } : m));
  saveStoredMovies(updatedList);
  return { id, ...payload };
};

/**
 * 5. DELETE MOVIE: Remove movie document from Cloud Firestore & Clean layout
 */
export const deleteMovie = async (id) => {
  if (!id) return false;

  // 1. Remove from local cache
  const currentList = getStoredMovies();
  const updatedList = currentList.filter(m => m && String(m.id) !== String(id));
  saveStoredMovies(updatedList);

  // 2. Clean ghost IDs from homepage layout
  try {
    const layout = await getHomepageLayout();
    if (layout) {
      const cleanLayout = {
        top10Movies: (layout.top10Movies || []).filter(mId => String(mId) !== String(id)),
        cinemaMovies: (layout.cinemaMovies || []).filter(mId => String(mId) !== String(id)),
        leaderboard: {
          trending: (layout.leaderboard?.trending || []).filter(mId => String(mId) !== String(id)),
          favorites: (layout.leaderboard?.favorites || []).filter(mId => String(mId) !== String(id)),
          newComments: (layout.leaderboard?.newComments || []).filter(mId => String(mId) !== String(id)),
        },
        comingSoon: (layout.comingSoon || []).filter(mId => String(mId) !== String(id)),
        animeVault: (layout.animeVault || []).filter(mId => String(mId) !== String(id)),
      };
      await saveHomepageLayout(cleanLayout);
    }
  } catch (e) {
    console.warn("Could not clean ghost IDs from layout:", e.message);
  }

  // 3. Delete from Firestore
  if (!id.startsWith('mock_') && !id.startsWith('local_') && !id.startsWith('imported_')) {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await withTimeout(deleteDoc(docRef), 3000);
    } catch (e) {
      console.warn("Firestore deleteDoc fallback:", e.message);
    }
  }

  return true;
};

/**
 * 6. HOMEPAGE LAYOUT CMS: Read settings/homepage_layout from Firestore
 */
export const getHomepageLayout = async () => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, LAYOUT_DOC_ID);
    const docSnap = await withTimeout(getDoc(docRef), 2500);
    if (docSnap && docSnap.exists()) {
      const data = docSnap.data();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
  } catch (e) {
    console.warn("Firestore getHomepageLayout fallback:", e.message);
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY) || localStorage.getItem('cobephim_homepage_layout');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Error reading local layout:", e);
  }

  return DEFAULT_HOMEPAGE_LAYOUT;
};

/**
 * 7. HOMEPAGE LAYOUT CMS: Save settings/homepage_layout to Firestore
 */
export const saveHomepageLayout = async (layoutData) => {
  const cleanPayload = sanitizeFirestoreData(layoutData);

  try {
    const docRef = doc(db, SETTINGS_COLLECTION, LAYOUT_DOC_ID);
    await withTimeout(setDoc(docRef, cleanPayload, { merge: true }), 3500);
  } catch (e) {
    console.warn("Firestore saveHomepageLayout fallback:", e.message);
  }

  // Save to local cache
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(cleanPayload));
  } catch (e) {
    console.warn("Error saving local layout:", e);
  }

  return cleanPayload;
};

/**
 * 8. BULK IMPORT: Helper to save bulk movies locally
 */
export const saveBulkMoviesLocally = (newMoviesArray) => {
  const currentList = getStoredMovies();
  const updatedList = [...newMoviesArray, ...currentList.filter(m => !newMoviesArray.some(nm => nm.id === m.id))];
  saveStoredMovies(updatedList);
  return updatedList;
};

/**
 * 9. SYNC ALL MOVIES TO CLOUD: Push all current movies in local cache up to Cloud Firestore
 */
export const syncAllLocalMoviesToCloud = async () => {
  const localList = getStoredMovies();
  if (!Array.isArray(localList) || localList.length === 0) {
    return { success: false, count: 0, message: "Không có phim nào trong bộ nhớ cục bộ để đồng bộ." };
  }

  const batch = writeBatch(db);
  localList.forEach(movie => {
    const { id, ...data } = movie;
    const docId = id && !id.startsWith('local_') && !id.startsWith('mock_') ? id : undefined;
    const docRef = docId ? doc(db, COLLECTION_NAME, docId) : doc(collection(db, COLLECTION_NAME));
    const cleanData = sanitizeFirestoreData({
      ...data,
      createdAt: data.createdAt || new Date().toISOString()
    });
    batch.set(docRef, cleanData, { merge: true });
  });

  await withTimeout(batch.commit(), 6000);
  return { success: true, count: localList.length };
};
