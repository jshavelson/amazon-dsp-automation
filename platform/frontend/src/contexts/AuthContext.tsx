import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, AuthContextType, LoginCredentials, LoginResponse } from '@/types/auth';
import { authApi } from '@/services/api';

// Create Auth Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Auth Provider Component
interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Check initial auth state
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('dsp-platform-id-token');
        const expiresAt = localStorage.getItem('token_expires_at');
        
        // If no token, auto-authenticate for development
        if (!token && import.meta.env.DEV) {
          // Development mode: auto-authenticate
          setUser({
            id: 'dev-user',
            email: 'dev@example.com',
            firstName: 'Developer',
            lastName: 'User',
            role: 'admin',
          } as User);
          setIsAuthenticated(true);
          setIsLoading(false);
          return;
        }

        if (!token) {
          setIsAuthenticated(false);
          setUser(null);
          setIsLoading(false);
          return;
        }

        // Check if token is expired
        if (expiresAt && Date.now() > parseInt(expiresAt)) {
          // Token expired, try to refresh
          const refreshToken = localStorage.getItem('refresh_token');
          if (refreshToken) {
            try {
              const response = await authApi.refreshToken(refreshToken);
              localStorage.setItem('auth_token', response.token);
              localStorage.setItem('refresh_token', response.refreshToken);
              localStorage.setItem('token_expires_at', (Date.now() + response.expiresIn * 1000).toString());
            } catch (refreshError) {
              // Refresh failed, clear tokens
              localStorage.removeItem('auth_token');
              localStorage.removeItem('refresh_token');
              localStorage.removeItem('token_expires_at');
              setIsAuthenticated(false);
              setUser(null);
              setIsLoading(false);
              return;
            }
          } else {
            // No refresh token, clear auth
            localStorage.removeItem('auth_token');
            localStorage.removeItem('token_expires_at');
            setIsAuthenticated(false);
            setUser(null);
            setIsLoading(false);
            return;
          }
        }

        // Token is valid, fetch current user
        try {
          const userData = await authApi.getCurrentUser();
          setUser(userData as User);
          setIsAuthenticated(true);
        } catch (userError) {
          if (import.meta.env.DEV) {
            console.warn('Failed to get current user, auto-authenticating for dev:', userError);
            setUser({
              id: 'dev-user',
              email: 'dev@example.com',
              firstName: 'Developer',
              lastName: 'User',
              role: 'admin',
            } as User);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
            setUser(null);
          }
        }
        
      } catch (err) {
        console.error('Auth check failed:', err);
        setError('Failed to check authentication');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Login function
  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const response: LoginResponse = await authApi.login(credentials);
      
      // Store tokens
      localStorage.setItem('auth_token', response.token);
      localStorage.setItem('refresh_token', response.refreshToken);
      
      // Set token expiration
      const expiresAt = Date.now() + response.expiresIn * 1000;
      localStorage.setItem('token_expires_at', expiresAt.toString());
      
      // Set user
      setUser(response.user as User);
      setIsAuthenticated(true);
      setIsLoading(false);
      
    } catch (err) {
      setError('Login failed. Please check your credentials.');
      setIsAuthenticated(false);
      setUser(null);
      setIsLoading(false);
      throw err;
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.error('Logout API call failed:', err);
    } finally {
      // Clear tokens regardless of API call success
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expires_at');
      sessionStorage.removeItem('dsp-platform-id-token');
      sessionStorage.removeItem('dsp-platform-token-expiry');
      
      setUser(null);
      setIsAuthenticated(false);
      setError(null);
      
      // Redirect to login
      window.location.href = import.meta.env.PROD ? '/' : '/login';
    }
  }, []);

  // Register function
  const register = useCallback(async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    phone?: string;
  }) => {
    setIsLoading(true);
    setError(null);

    try {
      await authApi.register(data);
      setIsLoading(false);
    } catch (err) {
      setError('Registration failed. Please try again.');
      setIsLoading(false);
      throw err;
    }
  }, []);

  // Refresh token function
  const refreshToken = useCallback(async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await authApi.refreshToken(refreshToken);
      localStorage.setItem('auth_token', response.token);
      localStorage.setItem('refresh_token', response.refreshToken);
      localStorage.setItem('token_expires_at', (Date.now() + response.expiresIn * 1000).toString());
    } catch (err) {
      // Clear tokens on refresh failure
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expires_at');
      setUser(null);
      setIsAuthenticated(false);
      throw err;
    }
  }, []);

  // Clear error function
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    register,
    refreshToken,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use Auth Context
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};

// Export the context for testing
export { AuthContext };
