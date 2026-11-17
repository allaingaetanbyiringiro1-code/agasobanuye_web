import axios from 'axios';

const baseURL = import.meta.env.PROD
  ? '/api'
  : import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const uploadBaseURL = import.meta.env.VITE_UPLOAD_API_URL
  || (import.meta.env.PROD
    ? 'https://backend-production-0d45ecbb.up.railway.app/api'
    : 'http://localhost:4000/api');

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' }
});

export async function uploadAdminForm(method, url, data) {
  const { data: session } = await api.post('/auth/upload-token');
  return axios.request({
    method,
    baseURL: uploadBaseURL,
    url,
    data,
    withCredentials: false,
    headers: { Authorization: `Bearer ${session.token}` }
  });
}

api.interceptors.request.use((config) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

export function assetUrl(source) {
  if (!source) return '';
  if (/^https?:\/\//i.test(source)) return source;
  const apiOrigin = new URL(api.defaults.baseURL, window.location.origin).origin;
  return new URL(source.replace(/^\/+/, ''), `${apiOrigin}/`).toString();
}

export function getErrorMessage(error) {
  const response = error.response?.data;
  const responseError = response?.error;
  if (typeof responseError === 'string') return responseError;
  if (typeof responseError?.message === 'string') return responseError.message;
  if (typeof response?.message === 'string') return response.message;
  return typeof error.message === 'string' ? error.message : 'Something went wrong.';
}
