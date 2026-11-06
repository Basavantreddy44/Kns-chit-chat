/**
 * Which files can be shared. This gives quick feedback in the browser; the storage
 * bucket and the database enforce the same rules on the server. Keep them in sync
 * with supabase/migrations/20261105150000_document_sharing.sql.
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_FILES_AT_ONCE = 10;

const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export const FILE_INPUT_ACCEPT = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',');

const extensionOf = (name) => name.split('.').pop()?.toLowerCase() ?? '';

/** The type comes from the extension, because browsers report some inconsistently. */
export const mimeTypeFor = (name) => (name.includes('.') ? MIME_BY_EXTENSION[extensionOf(name)] ?? null : null);

/** Returns a reason this file can't be shared, or '' when it can. */
export function validateFile(file) {
  if (!mimeTypeFor(file.name)) {
    return 'This file type isn’t supported. Share PDF, Word, Excel, PowerPoint, text, CSV, PNG or JPG files.';
  }
  if (file.size > MAX_FILE_SIZE) return 'This file is larger than the 25 MB limit.';
  if (file.size === 0) return 'This file is empty.';
  if (file.name.length > 255) return 'This file’s name is too long.';
  return '';
}

export const isImageType = (mimeType) => mimeType?.startsWith('image/');

/** Types a browser can show safely in a tab. Office files can only be downloaded. */
export const canOpenInBrowser = (mimeType) =>
  isImageType(mimeType) || mimeType === 'application/pdf' || mimeType === 'text/plain';

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
