export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('vox_ia_token');
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('vox_ia_token');
    window.location.reload(); // Force reload to trigger login screen
    throw new Error('No autorizado');
  }

  return response;
}
