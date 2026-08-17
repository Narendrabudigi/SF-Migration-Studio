import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const endpoint = isLogin ? `${import.meta.env.VITE_BACKEND_URL}/api/auth/login` : `${import.meta.env.VITE_BACKEND_URL}/api/auth/signup`;
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }

      if (isLogin) {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('user_id', data.user_id);
        navigate('/');
      } else {
        alert('Signup successful! Please log in.');
        setIsLogin(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <div className="bg-[var(--bg-tertiary)] p-8 rounded-xl shadow-lg max-w-sm w-full border border-[var(--border)]">
        <h2 className="text-2xl font-bold mb-6 text-center">
          {isLogin ? 'Login to Migration Studio' : 'Create an Account'}
        </h2>
        {error && <div className="mb-4 text-red-500 text-sm">{error}</div>}
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Email</label>
            <input
              type="email"
              className="w-full px-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg outline-none focus:border-primary-500 transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Password</label>
            <input
              type="password"
              className="w-full px-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg outline-none focus:border-primary-500 transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-2 rounded-lg transition-colors">
            {isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>
        <div className="mt-4 text-center">
          <button onClick={() => setIsLogin(!isLogin)} className="text-xs text-primary-400 hover:text-primary-300">
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}
