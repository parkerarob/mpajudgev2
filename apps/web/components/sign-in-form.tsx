'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const supabase = createClient();
    if (mode === 'sign_in') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(signInError.message);
        setPending(false);
        return;
      }

      router.replace('/');
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName.trim() || email,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setPending(false);
      return;
    }

    if (data.session) {
      router.replace('/');
      router.refresh();
      return;
    }

    setMessage('Account created. If email confirmation is enabled, confirm it before signing in.');
    setMode('sign_in');
    setPending(false);
  }

  return (
    <form className="panel form-stack" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">Rebuild Dev</p>
        <h1>{mode === 'sign_in' ? 'Sign in' : 'Create account'}</h1>
        <p className="lede">
          This shell targets the hosted Supabase rebuild project. Create an account here, then use the
          admin workspace to assign judge, chair, or director access.
        </p>
      </div>

      <div className="action-row">
        <button
          className={mode === 'sign_in' ? 'button button-tight' : 'button button-secondary button-tight'}
          type="button"
          onClick={() => {
            setMode('sign_in');
            setError(null);
            setMessage(null);
          }}
        >
          Sign in
        </button>
        <button
          className={mode === 'sign_up' ? 'button button-tight' : 'button button-secondary button-tight'}
          type="button"
          onClick={() => {
            setMode('sign_up');
            setError(null);
            setMessage(null);
          }}
        >
          Create account
        </button>
      </div>

      {mode === 'sign_up' ? (
        <label className="field">
          <span>Display name</span>
          <input
            autoComplete="name"
            name="displayName"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required={mode === 'sign_up'}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Email</span>
        <input
          autoComplete="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>

      {message ? <p className="lede">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <button className="button" type="submit" disabled={pending}>
        {pending ? (mode === 'sign_in' ? 'Signing in…' : 'Creating…') : mode === 'sign_in' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
