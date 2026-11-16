// Where the app gets a marketplace picture (lib/faces.ts Face.image): its own local route, which keeps
// a copy on this computer (app/api/avatars/[id]/route.ts). The website has its own version of this file.
export const avatarSrc = (id: string) => `/api/avatars/${id}`;
