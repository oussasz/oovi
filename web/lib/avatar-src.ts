// Where the website gets a marketplace picture (lib/faces.ts Face.image): the public avatars route.
// The desktop app has its own version of this file (its local copy on the computer).
export const avatarSrc = (id: string) => `/api/v1/avatars/${id}`;
