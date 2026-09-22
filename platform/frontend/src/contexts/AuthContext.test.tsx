import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function AuthProbe() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  if (isLoading) return <div>Loading</div>;
  return (
    <div>
      <span>{isAuthenticated ? 'Authenticated' : 'Logged out'}</span>
      <button type="button" onClick={() => void logout()}>Logout</button>
    </div>
  );
}

describe('AuthProvider logout', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does not immediately auto-authenticate again after a manual development logout', async () => {
    const first = render(<AuthProvider><AuthProbe /></AuthProvider>);
    expect(await screen.findByText('Authenticated')).toBeInTheDocument();

    await act(async () => screen.getByRole('button', { name: 'Logout' }).click());
    expect(screen.getByText('Logged out')).toBeInTheDocument();
    expect(sessionStorage.getItem('dsp-development-logged-out')).toBe('true');

    first.unmount();
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    expect(await screen.findByText('Logged out')).toBeInTheDocument();
  });
});
