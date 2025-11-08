import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, query, addDoc, serverTimestamp } from 'firebase/firestore';

// --- Global Firebase Configuration (Mandatory Usage) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initial data from the user's uploaded bookmark file
const initialBookmarksData = [
    { id: 'b1', name: 'Google', url: 'https://www.google.com/' },
    { id: 'b2', name: 'Reasoning Shortcut Tricks', url: 'https://www.anujjindal.in/project/nabard/' },
];

/**
 * Main application component combining Blog and Bookmark features.
 * Uses signals/state for simple client-side routing.
 */
const App = () => {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    const [currentPage, setCurrentPage] = useState('blog'); // 'blog', 'post', 'bookmarks'
    const [posts, setPosts] = useState([]);
    const [bookmarks, setBookmarks] = useState([]);

    const [selectedPost, setSelectedPost] = useState(null);
    const [newPost, setNewPost] = useState({ title: '', content: '' });
    const [newBookmark, setNewBookmark] = useState({ name: '', url: '' });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestore);
            setAuth(firebaseAuth);

            // Log in with custom token or anonymously
            const authenticate = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (error) {
                    console.error("Firebase Auth Error:", error);
                    setMessage("Authentication failed. Check console for details.");
                }
            };

            authenticate();

            // Auth state listener
            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null);
                }
                setIsAuthReady(true);
                setLoading(false);
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Failed to initialize Firebase:", e);
            setMessage("Error initializing Firebase. Please check your configuration.");
            setLoading(false);
        }
    }, []);

    // --- Firestore Data Listeners (Blog Posts - Public) ---
    useEffect(() => {
        if (!isAuthReady || !db) return;

        const collectionPath = `/artifacts/${appId}/public/data/blog_posts`;
        const q = query(collection(db, collectionPath));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedPosts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate().toLocaleString(),
            })).sort((a, b) => b.timestamp - a.timestamp); // Sort descending

            setPosts(fetchedPosts);
        }, (error) => {
            console.error("Error listening to blog posts:", error);
            setMessage("Failed to load blog posts.");
        });

        return () => unsubscribe();
    }, [db, isAuthReady]);


    // --- Firestore Data Listeners (Bookmarks - Private) ---
    useEffect(() => {
        if (!isAuthReady || !db || !userId) {
            // If authenticated and user ID is available, and there are no bookmarks,
            // initialize with static data and prompt to save.
            if (isAuthReady && userId && bookmarks.length === 0) {
                setBookmarks(initialBookmarksData);
            }
            return;
        }

        const collectionPath = `/artifacts/${appId}/users/${userId}/bookmarks`;
        const q = query(collection(db, collectionPath));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedBookmarks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));

            if (fetchedBookmarks.length === 0) {
                 // Load initial data if none are saved in Firestore yet
                setBookmarks(initialBookmarksData.map(b => ({ ...b, saved: false })));
            } else {
                setBookmarks(fetchedBookmarks.map(b => ({ ...b, saved: true })));
            }
        }, (error) => {
            console.error("Error listening to bookmarks:", error);
            setMessage("Failed to load bookmarks.");
        });

        return () => unsubscribe();
    }, [db, isAuthReady, userId]);

    // --- Handlers for Blog ---
    const handlePostSubmit = useCallback(async (e) => {
        e.preventDefault();
        if (!db || !userId) return setMessage("App not ready. Please wait.");
        if (!newPost.title || !newPost.content) return setMessage("Title and content are required.");

        const collectionPath = `/artifacts/${appId}/public/data/blog_posts`;

        try {
            await addDoc(collection(db, collectionPath), {
                title: newPost.title,
                content: newPost.content,
                authorId: userId,
                timestamp: serverTimestamp(),
            });
            setNewPost({ title: '', content: '' });
            setCurrentPage('blog'); // Go back to the list
            setMessage("Post published successfully!");
        } catch (error) {
            console.error("Error writing document: ", error);
            setMessage("Failed to publish post.");
        }
    }, [db, userId, newPost]);

    // --- Handlers for Bookmarks ---
    const handleBookmarkAdd = useCallback(async (e) => {
        e.preventDefault();
        if (!db || !userId) return setMessage("App not ready. Please wait.");
        if (!newBookmark.name || !newBookmark.url) return setMessage("Name and URL are required.");

        const collectionPath = `/artifacts/${appId}/users/${userId}/bookmarks`;

        try {
            await addDoc(collection(db, collectionPath), {
                name: newBookmark.name,
                url: newBookmark.url,
            });
            setNewBookmark({ name: '', url: '' });
            setMessage("Bookmark saved successfully!");
        } catch (error) {
            console.error("Error saving bookmark: ", error);
            setMessage("Failed to save bookmark.");
        }
    }, [db, userId, newBookmark]);

    const handleBookmarkDelete = useCallback(async (bookmarkId) => {
        if (!db || !userId) return setMessage("App not ready. Please wait.");

        const bookmarkToDelete = bookmarks.find(b => b.id === bookmarkId);
        if (!bookmarkToDelete || !bookmarkToDelete.saved) {
             // If not saved to Firestore, just remove it from local state
             setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
             setMessage("Bookmark removed locally.");
             return;
        }

        const docPath = `/artifacts/${appId}/users/${userId}/bookmarks/${bookmarkId}`;

        try {
            await deleteDoc(doc(db, docPath));
            setMessage("Bookmark deleted successfully!");
        } catch (error) {
            console.error("Error deleting bookmark: ", error);
            setMessage("Failed to delete bookmark.");
        }
    }, [db, userId, bookmarks]);

    const handleInitialBookmarkSave = useCallback(async (bookmark) => {
        if (!db || !userId) return setMessage("App not ready. Please wait.");

        const collectionPath = `/artifacts/${appId}/users/${userId}/bookmarks`;

        try {
            await addDoc(collection(db, collectionPath), {
                name: bookmark.name,
                url: bookmark.url,
            });
            setBookmarks(prev => prev.map(b => b.id === bookmark.id ? { ...b, saved: true } : b));
            setMessage(`Initial bookmark '${bookmark.name}' saved!`);
        } catch (error) {
            console.error("Error saving initial bookmark: ", error);
            setMessage("Failed to save initial bookmark.");
        }
    }, [db, userId]);

    // --- UI Components/Views ---

    const Header = () => (
        <header className="bg-blue-700 shadow-xl fixed top-0 left-0 right-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center py-3">
                <h1 className="text-2xl font-bold text-white tracking-wide">
                    Gemini Blog & Bookmarks
                </h1>
                <div className="flex space-x-4">
                    <button
                        onClick={() => { setCurrentPage('blog'); setSelectedPost(null); }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition duration-200 ${currentPage === 'blog' ? 'bg-white text-blue-700 shadow-md' : 'text-blue-200 hover:text-white hover:bg-blue-600'}`}
                    >
                        <i className="fas fa-file-alt mr-1"></i> Blog
                    </button>
                    <button
                        onClick={() => setCurrentPage('bookmarks')}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition duration-200 ${currentPage === 'bookmarks' ? 'bg-white text-blue-700 shadow-md' : 'text-blue-200 hover:text-white hover:bg-blue-600'}`}
                    >
                        <i className="fas fa-bookmark mr-1"></i> Bookmarks
                    </button>
                    <button
                        onClick={() => { setSelectedPost(null); setCurrentPage('post'); }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition duration-200 ${currentPage === 'post' ? 'bg-yellow-400 text-gray-900 shadow-md' : 'text-blue-200 hover:text-white hover:bg-blue-600'}`}
                    >
                        <i className="fas fa-plus-circle mr-1"></i> New Post
                    </button>
                </div>
            </div>
        </header>
    );

    const BlogList = () => (
        <div className="space-y-4">
            <h2 className="text-3xl font-extrabold text-gray-800 border-b pb-2 mb-6">Latest Blog Posts</h2>
            {posts.length === 0 ? (
                <p className="text-gray-500 italic">No posts yet. Be the first to publish one!</p>
            ) : (
                posts.map(post => (
                    <div
                        key={post.id}
                        className="bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition duration-300 border border-gray-100 cursor-pointer"
                        onClick={() => { setSelectedPost(post); setCurrentPage('post'); }}
                    >
                        <h3 className="text-xl font-bold text-blue-600">{post.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                            Published by: <span className="font-mono text-xs bg-gray-100 px-1 rounded">{post.authorId}</span> on {post.timestamp}
                        </p>
                        <p className="mt-3 text-gray-600 line-clamp-2">{post.content}</p>
                    </div>
                ))
            )}
        </div>
    );

    const PostDetail = ({ post }) => (
        <div className="bg-white p-6 rounded-xl shadow-xl">
            <h2 className="text-3xl font-extrabold text-gray-800 mb-2">{post.title}</h2>
            <p className="text-sm text-gray-500 mb-6 border-b pb-4">
                By: <span className="font-mono text-xs bg-gray-100 px-1 rounded">{post.authorId}</span> | Published: {post.timestamp}
            </p>
            <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                {post.content}
            </div>
            <button
                onClick={() => { setSelectedPost(null); setCurrentPage('blog'); }}
                className="mt-8 px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition duration-150"
            >
                <i className="fas fa-arrow-left mr-2"></i>Back to Blog
            </button>
        </div>
    );

    const PostEditor = () => (
        <div className="bg-white p-6 rounded-xl shadow-xl">
            <h2 className="text-3xl font-extrabold text-gray-800 mb-6 border-b pb-2">
                {selectedPost ? 'Edit Post (Not Implemented)' : 'Write a New Blog Post'}
            </h2>
            <form onSubmit={handlePostSubmit} className="space-y-4">
                <div>
                    <label htmlFor="postTitle" className="block text-sm font-medium text-gray-700">Title</label>
                    <input
                        id="postTitle"
                        type="text"
                        value={newPost.title}
                        onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                        className="mt-1 block w-full border-gray-300 border rounded-lg shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500"
                        required
                    />
                </div>
                <div>
                    <label htmlFor="postContent" className="block text-sm font-medium text-gray-700">Content</label>
                    <textarea
                        id="postContent"
                        rows="10"
                        value={newPost.content}
                        onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                        className="mt-1 block w-full border-gray-300 border rounded-lg shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500"
                        required
                    ></textarea>
                </div>
                <button
                    type="submit"
                    className="w-full px-4 py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition duration-150 shadow-md"
                >
                    <i className="fas fa-paper-plane mr-2"></i>Publish Post
                </button>
            </form>
        </div>
    );

    const BookmarkManager = () => (
        <div className="space-y-6">
            <h2 className="text-3xl font-extrabold text-gray-800 border-b pb-2">My Personal Bookmarks</h2>

            {/* Bookmark Creation Form */}
            <div className="bg-blue-50 p-6 rounded-xl shadow-inner border-blue-200 border">
                <h3 className="text-xl font-semibold text-blue-700 mb-4">Add New Bookmark</h3>
                <form onSubmit={handleBookmarkAdd} className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="text"
                        placeholder="Name (e.g., Google)"
                        value={newBookmark.name}
                        onChange={(e) => setNewBookmark({ ...newBookmark, name: e.target.value })}
                        className="flex-1 border-gray-300 border rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
                        required
                    />
                    <input
                        type="url"
                        placeholder="URL (e.g., https://www.google.com/)"
                        value={newBookmark.url}
                        onChange={(e) => setNewBookmark({ ...newBookmark, url: e.target.value })}
                        className="flex-1 border-gray-300 border rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
                        required
                    />
                    <button
                        type="submit"
                        className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition duration-150 shadow-md sm:w-auto"
                    >
                        <i className="fas fa-save mr-1"></i> Save
                    </button>
                </form>
            </div>

            {/* Bookmark List */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg border border-gray-100">
                {bookmarks.length === 0 ? (
                    <p className="text-gray-500 italic">No bookmarks saved yet.</p>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {bookmarks.map((bookmark) => (
                            <li key={bookmark.id} className="flex justify-between items-center py-3">
                                <a
                                    href={bookmark.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 font-medium text-gray-800 hover:text-blue-600 truncate"
                                >
                                    {bookmark.name}
                                    <span className="text-xs text-gray-400 ml-2 group-hover:text-blue-500">({new URL(bookmark.url).hostname})</span>
                                </a>

                                <div className="flex items-center space-x-2">
                                    {!bookmark.saved && (
                                        <button
                                            onClick={() => handleInitialBookmarkSave(bookmark)}
                                            className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full hover:bg-yellow-200 transition duration-150"
                                            title="Save to Firestore"
                                        >
                                            <i className="fas fa-cloud-upload-alt"></i> Save Initial
                                        </button>
                                    )}
                                    <a
                                        href={bookmark.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-gray-500 hover:text-blue-500 transition duration-150"
                                        title="Visit Link"
                                    >
                                        <i className="fas fa-external-link-alt"></i>
                                    </a>
                                    <button
                                        onClick={() => handleBookmarkDelete(bookmark.id)}
                                        className="text-red-400 hover:text-red-600 transition duration-150"
                                        title="Delete Bookmark"
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-sm text-gray-500 mt-4 p-4 bg-gray-100 rounded-lg">
                Your user ID: <span className="font-mono text-xs bg-gray-200 px-1 rounded">{userId}</span>. This ID determines which private bookmarks you see.
            </p>
        </div>
    );

    // --- Main Renderer (Client-side Routing) ---
    const renderContent = useMemo(() => {
        if (loading) {
            return (
                <div className="text-center py-20">
                    <i className="fas fa-spinner fa-spin text-4xl text-blue-500"></i>
                    <p className="mt-4 text-gray-600">Loading application...</p>
                </div>
            );
        }

        switch (currentPage) {
            case 'blog':
                return <BlogList />;
            case 'post':
                return selectedPost ? <PostDetail post={selectedPost} /> : <PostEditor />;
            case 'bookmarks':
                return <BookmarkManager />;
            default:
                return <BlogList />;
        }
    }, [currentPage, loading, selectedPost, posts, bookmarks, userId, handlePostSubmit, handleBookmarkAdd, handleBookmarkDelete, handleInitialBookmarkSave]);

    return (
        <div className="min-h-screen bg-gray-50">
            <script src="https://kit.fontawesome.com/a076d05399.js" crossOrigin="anonymous"></script>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
            <style jsx="true">{`
                body { font-family: 'Inter', sans-serif; }
                .line-clamp-2 {
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }
            `}</style>
            <Header />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
                {message && (
                    <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded-lg mb-6 shadow-md" role="alert">
                        <p className="font-bold">Notice:</p>
                        <p className="text-sm">{message}</p>
                    </div>
                )}
                {renderContent}
            </main>
        </div>
    );
};

export default App;
