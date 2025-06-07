// Enhanced service worker for karaoke app performance
const CACHE_NAME = 'karaoke-app-v1';
const STATIC_CACHE_NAME = 'karaoke-static-v1';
const SEARCH_CACHE_NAME = 'karaoke-search-v1';

// Static assets to cache
const STATIC_ASSETS = [
  '/',
  '/static/css/main.css',
  '/static/js/main.js',
  '/genie_logo.svg',
  '/melon_logo.svg',
  '/favicon.ico',
];

// Cache strategies for different types of requests
const CACHE_STRATEGIES = {
  static: 'cache-first',
  search: 'network-first',
  images: 'cache-first',
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      }),
      self.skipWaiting()
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_NAME && 
                     cacheName !== STATIC_CACHE_NAME && 
                     cacheName !== SEARCH_CACHE_NAME;
            })
            .map((cacheName) => caches.delete(cacheName))
        );
      }),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle different types of requests
  if (request.method !== 'GET') return;

  // Cache static assets (cache-first)
  if (STATIC_ASSETS.some(asset => url.pathname.includes(asset))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE_NAME));
    return;
  }

  // Cache search requests (network-first with short TTL)
  if (url.hostname.includes('meilisearch')) {
    event.respondWith(networkFirstWithTTL(request, SEARCH_CACHE_NAME, 300000)); // 5 minutes
    return;
  }

  // Cache images (cache-first)
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // Default: network-first for everything else
  event.respondWith(networkFirst(request, CACHE_NAME));
});

// Cache-first strategy
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('Cache-first fetch failed:', error);
    throw error;
  }
}

// Network-first strategy
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

// Network-first with TTL (Time To Live)
async function networkFirstWithTTL(request, cacheName, ttl) {
  const cache = await caches.open(cacheName);
  const cacheKey = `${request.url}_timestamp`;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Store with timestamp
      const responseToCache = response.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('sw-cache-timestamp', Date.now().toString());
      
      const modifiedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      cache.put(request, modifiedResponse);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      const timestamp = cached.headers.get('sw-cache-timestamp');
      if (timestamp && (Date.now() - parseInt(timestamp)) < ttl) {
        return cached;
      } else {
        // Cache expired, remove it
        cache.delete(request);
      }
    }
    throw error;
  }
}

// Clean up expired search cache periodically
setInterval(() => {
  caches.open(SEARCH_CACHE_NAME).then(cache => {
    cache.keys().then(requests => {
      requests.forEach(async (request) => {
        const response = await cache.match(request);
        if (response) {
          const timestamp = response.headers.get('sw-cache-timestamp');
          if (timestamp && (Date.now() - parseInt(timestamp)) > 300000) { // 5 minutes
            cache.delete(request);
          }
        }
      });
    });
  });
}, 600000); // Run every 10 minutes
