import { AuthError } from './AuthError';
import { rpc } from './employeeService';
import { getSupabase, getSupabaseSettings } from './supabaseClient';

/**
 * Profile pictures. avatar_url holds a path in the avatars bucket, never a web address.
 * See supabase/migrations/20261106090000_profile_pictures.sql.
 */

const BUCKET = 'avatars';
const SIZE_PX = 256;
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const AVATAR_INPUT_ACCEPT = ACCEPTED_TYPES.join(',');

export function avatarUrl(path) {
  if (!path) return '';
  return `${getSupabaseSettings().url?.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Crops to a centred square and re-encodes it. A small file loads fast everywhere,
 * and redrawing leaves behind photo metadata such as the location it was taken.
 */
async function prepareImage(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new AuthError('Please choose a JPG, PNG or WebP image.', 'VALIDATION_ERROR');
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new AuthError('This image is too large. Please choose one under 15 MB.', 'VALIDATION_ERROR');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AuthError('This image couldn’t be read. Please choose another.', 'VALIDATION_ERROR');
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE_PX, SIZE_PX);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new AuthError('This image couldn’t be read. Please choose another.', 'VALIDATION_ERROR');
  return blob.arrayBuffer();
}

async function removeFile(path) {
  if (!path) return;
  try {
    await getSupabase().storage.from(BUCKET).remove([path]);
  } catch {
    // Harmless: the profile no longer points at it.
  }
}

export async function setProfilePicture(userId, file) {
  const image = await prepareImage(file);
  const path = `${userId}/${crypto.randomUUID()}`;

  const { error } = await getSupabase().storage.from(BUCKET).upload(path, image, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new AuthError('The picture couldn’t be uploaded. Please try again.', 'SERVER_ERROR');

  try {
    const previous = await rpc('set_my_avatar', { p_path: path });
    await removeFile(previous);
  } catch (saveError) {
    await removeFile(path);
    throw saveError;
  }
}

export async function removeProfilePicture() {
  const previous = await rpc('set_my_avatar', { p_path: null });
  await removeFile(previous);
}
