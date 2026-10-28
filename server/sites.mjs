// 站点白名单唯一来源：服务端与原生 JS 共用；Swift/Java 壳仍需同步，测试会校验两边一致。
export const MT_BASES = ['https://api.m-team.cc/api', 'https://api.m-team.io/api'];
export const MTEAM_PATHS = [
  '/api/member/profile',
  '/api/tracker/myPeerStatistics',
  '/api/tracker/myPeerStatus',
  '/api/tracker/mybonus',
  '/api/torrent/search',
  '/api/torrent/genDlToken',
];
export const TJUPT_BASE = 'https://tjupt.org';
export const TJUPT_HOSTS = ['tjupt.org', 'www.tjupt.org'];
export const TJUPT_PATHS = [
  '/login.php',
  '/takelogin.php',
  '/usercp.php',
  '/index.php',
  '/userdetails.php',
  '/mybonus.php',
  '/getusertorrentlistajax.php',
  '/torrents.php',
  '/details.php',
  '/download.php',
  '/torrentrss.php',
];
export const isMTBase = (value) => MT_BASES.includes(value);
