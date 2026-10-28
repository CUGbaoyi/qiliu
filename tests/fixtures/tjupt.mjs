// 依据 TJUPT 2026 线上结构合成的夹具（不含真实账号数据）。
export const detailsHtml = `<html><head><title>北洋园PT :: 用户详情 - alice - Powered by NexusPHP</title></head><body>
<a href="logout.php">退出</a>
<span class="color_bonus"> 等级: </span>[<a href="/classes.php#3"><span class='EliteUser_Name'>持剑下山</span></a>]
<span class="color_bonus"> 魔力值 </span>[<a href="mybonus.php">使用</a>|<a href="mybonusapps.php">茉莉园</a>]: <a href="bonus.php?show=log">12,345.6</a>
<span class="color_uploaded">上传量:</span> 1.50 TiB
<span class="color_downloaded">下载量:</span> 614.40 GiB
<span class="color_ratio">分享率:</span> 2.500
<span class="color_active">活动种子:</span> <img class="arrowup" alt="Torrents seeding" title="当前做种数" src="pic/trans.gif"/>2 <img class="arrowdown" alt="Torrents leeching" title="当前下载数" src="pic/trans.gif"/>0
<img class="tfabig" src="pic/2fa.svg" alt="2FA" title="两步验证" />
<a href="userdetails.php?id=42">alice</a>
<table><tr><td class="rowhead nowrap">加入日期</td><td class="rowfollow">2022-04-02 00:09:03 (<span title="2022-04-02 00:09:03">4年7月前</span>)</td></tr></table>
</body></html>`;

export const seedingHtml = `<b>2</b>条记录 - 总大小4.60 GiB<br /><table class='coltable table-left torrentlist'><tr><td class="colhead">类型</td><td class="colhead">标题</td><td class="colhead"><img class="size" alt="size" title="大小" /></td></tr>
<tr><td class="rowfollow nowrap">电影</td><td class="rowfollow"><a href="details.php?id=1">A</a></td><td class="rowfollow">1.20<br />GiB</td></tr>
<tr><td class="rowfollow nowrap">剧集</td><td class="rowfollow"><a href="details.php?id=2">B</a></td><td class="rowfollow">3.40<br />GiB</td></tr>
</table>`;

export const listHtml = `<table class="torrents"><tr><td class="colhead">类型</td><td class="colhead">标题</td></tr>
<tr><td class="rowfollow nowrap"><a href="?search=x&cat=401"><img class="c_movies" alt="电影" /></a></td><td class="rowfollow" width="100%"><table class="torrentname" width="100%"><tr><td class="embedded"><a title="Sintel 2010 1080p" href="details.php?id=1001&amp;hit=1"><b>Sintel</b></a></td></tr></table></td><td class="rowfollow"><a href='comment.php?pid=1001'>3</a></td><td class="rowfollow">2026-10-28<br />10:00:00</td><td class="rowfollow">1.20<br />GiB</td><td class="rowfollow"><b><a href="#">12</a></b></td><td class="rowfollow">3</td><td class="rowfollow"><a href="#"><b>7</b></a></td></tr>
<tr><td class="rowfollow nowrap"><a href="?search=x&cat=402"><img class="c_tvseries" alt="剧集" /></a></td><td class="rowfollow" width="100%"><table class="torrentname" width="100%"><tr><td class="embedded"><a title="Some Show 2160p" href="details.php?id=1002"><b>Some Show</b></a><img class="pro_free2up" alt="2X免费" title="2X免费" /></td></tr></table></td><td class="rowfollow"><a href='comment.php?pid=1002'>5</a></td><td class="rowfollow">2026-10-28<br />08:00:00</td><td class="rowfollow">4.80<br />GiB</td><td class="rowfollow"><b><a href="#">45</a></b></td><td class="rowfollow">18</td><td class="rowfollow"><a href="#"><b>2</b></a></td></tr>
</table>`;
