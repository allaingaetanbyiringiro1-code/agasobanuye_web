import axios from 'axios';

const baseURL = import.meta.env.PROD
  ? '/api'
  : import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const uploadBaseURL = import.meta.env.VITE_UPLOAD_API_URL
  || (import.meta.env.PROD
    ? 'https://backend-production-0d45ecbb.up.railway.app/api'
    : 'http://localhost:4000/api');
const uploadChunkSize = 4 * 1024 * 1024;
const uploadTokenRefreshMs = 8 * 60 * 1000;

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' }
});

export async function uploadAdminForm(method, url, data) {
  let token;
  let tokenCreatedAt = 0;
  const getUploadToken = async () => {
    if (!token || Date.now() - tokenCreatedAt >= uploadTokenRefreshMs) {
      const { data: session } = await api.post('/auth/upload-token');
      token = session.token;
      tokenCreatedAt = Date.now();
    }
    return token;
  };
  const uploadedFiles = {};
  const form = new FormData();

  for (const [field, value] of data.entries()) {
    if (typeof File !== 'undefined' && value instanceof File) {
      if (!value.name) continue;
      if (!value.size) throw new Error(`The selected ${field} file is empty.`);

      const tokenForSession = await getUploadToken();
      const { data: session } = await axios.post(
        `${uploadBaseURL}/admin/uploads`,
        { field, mimetype: value.type, size: value.size },
        { withCredentials: false, headers: { Authorization: `Bearer ${tokenForSession}` } }
      );
      const chunkCount = Math.ceil(value.size / session.chunkSize);
      if (!session.uploadId || session.chunkSize !== uploadChunkSize || chunkCount !== session.chunkCount) {
        throw new Error('The upload session could not be initialized.');
      }

      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const tokenForChunk = await getUploadToken();
          const start = index * session.chunkSize;
          const chunk = value.slice(start, Math.min(start + session.chunkSize, value.size));
          let attempt = 0;
          while (true) {
            try {
              await axios.put(
                `${uploadBaseURL}/admin/uploads/${session.uploadId}/chunks/${index}`,
                chunk,
                {
                  withCredentials: false,
                  headers: {
                    Authorization: `Bearer ${tokenForChunk}`,
                    'Content-Type': 'application/octet-stream'
                  }
                }
              );
              break;
            } catch (error) {
              if (attempt >= 2 || (error.response && error.response.status < 500)) throw error;
              attempt += 1;
              await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
          }
        }

        const tokenForCompletion = await getUploadToken();
        const { data: completed } = await axios.post(
          `${uploadBaseURL}/admin/uploads/${session.uploadId}/complete`,
          null,
          { withCredentials: false, headers: { Authorization: `Bearer ${tokenForCompletion}` } }
        );
        uploadedFiles[field] = { filename: completed.filename, mimetype: completed.mimetype };
      } catch (error) {
        try {
          const cleanupToken = await getUploadToken();
          await axios.delete(`${uploadBaseURL}/admin/uploads/${session.uploadId}`, {
            withCredentials: false,
            headers: { Authorization: `Bearer ${cleanupToken}` }
          });
        } catch (cleanupError) {
          console.error('Unable to cancel incomplete media upload:', cleanupError.message);
        }
        throw error;
      }
    } else {
      form.append(field, value);
    }
  }

  if (Object.keys(uploadedFiles).length) {
    form.append('uploaded_files', JSON.stringify(uploadedFiles));
  }
  return api.request({ method, url, data: form });
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
