import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { User } from '@/types/auth';

// Query keys
const AUTH_KEYS = {
  currentUser: ['auth', 'current-user'],
};

// Hook to get current user
export const useCurrentUser = () => {
  return useQuery({
    queryKey: AUTH_KEYS.currentUser,
    queryFn: () => authApi.getCurrentUser(),
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Hook for login
export const useLogin = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      // Store tokens
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('refresh_token', data.refreshToken);
      
      // Set token expiration
      const expiresAt = Date.now() + data.expiresIn * 1000;
      localStorage.setItem('token_expires_at', expiresAt.toString());
      
      // Invalidate current user query
      queryClient.invalidateQueries({ queryKey: AUTH_KEYS.currentUser });
      
      // Fetch current user
      queryClient.setQueryData(AUTH_KEYS.currentUser, data.user);
    },
    onError: (error) => {
      console.error('Login failed:', error);
    },
  });
};

// Hook for logout
export const useLogout = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      // Clear tokens
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expires_at');
      
      // Clear user data
      queryClient.setQueryData(AUTH_KEYS.currentUser, null);
      queryClient.removeQueries();
      
      // Redirect to login
      window.location.href = '/login';
    },
    onError: (error) => {
      console.error('Logout failed:', error);
    },
  });
};

// Hook for token refresh
export const useRefreshToken = () => {
  return useMutation({
    mutationFn: authApi.refreshToken,
    onSuccess: (data) => {
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('refresh_token', data.refreshToken);
      
      const expiresAt = Date.now() + data.expiresIn * 1000;
      localStorage.setItem('token_expires_at', expiresAt.toString());
    },
    onError: (error) => {
      console.error('Token refresh failed:', error);
      // Clear tokens on refresh failure
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expires_at');
      window.location.href = '/login';
    },
  });
};

// Hook for forgot password
export const useForgotPassword = () => {
  return useMutation({
    mutationFn: authApi.forgotPassword,
    onSuccess: () => {
      // Show success message
    },
    onError: (error) => {
      console.error('Forgot password failed:', error);
    },
  });
};

// Hook for reset password
export const useResetPassword = () => {
  return useMutation({
    mutationFn: authApi.resetPassword,
    onSuccess: () => {
      // Redirect to login
      window.location.href = '/login';
    },
    onError: (error) => {
      console.error('Reset password failed:', error);
    },
  });
};

// Hook for change password
export const useChangePassword = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      // Invalidate current user to get fresh data
      queryClient.invalidateQueries({ queryKey: AUTH_KEYS.currentUser });
    },
    onError: (error) => {
      console.error('Change password failed:', error);
    },
  });
};

// Custom hook to check authentication status
export const useAuth = () => {
  const { data: user, isLoading, error, refetch } = useCurrentUser();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  
  const isAuthenticated = !!user;
  
  return {
    user: user as User | null,
    isAuthenticated,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    refetch,
  };
};
