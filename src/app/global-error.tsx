'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#666' }}>{error?.message || 'An unexpected error occurred'}</p>
          <button 
            onClick={() => reset()}
            style={{ 
              padding: '0.5rem 1rem', 
              background: '#0070f3', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
