export const dynamic='force-dynamic';
export function GET(){return Response.json({revision:process.env.RELEASE_GIT_SHA??null,feature:'collaborative-bounties'});}
