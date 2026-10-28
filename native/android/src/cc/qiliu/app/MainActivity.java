package cc.qiliu.app;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.content.Intent;
import android.net.Uri;
import android.view.*;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
 private WebView web;private final ExecutorService pool=Executors.newFixedThreadPool(4);
 private static final String ORIGIN="https://qiliu.local", CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 @Override public void onCreate(Bundle b){super.onCreate(b);web=new WebView(this);setContentView(web);web.setBackgroundColor(0xfffaf9f7);
 web.setOnApplyWindowInsetsListener((v,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);}return insets;});
 WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setSupportMultipleWindows(false);
 android.webkit.CookieManager.getInstance().setAcceptCookie(false);web.addJavascriptInterface(new Bridge(),"QiliuAndroid");
 web.setWebViewClient(new WebViewClient(){
 @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(u.toString().startsWith(ORIGIN+"/"))return false;if("https".equals(u.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}}return true;}
 @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(!"qiliu.local".equals(u.getHost()))return null;try{String path=u.getPath();if(path==null||path.equals("/"))path="/index.html";if(path.contains("..")||!"https".equals(u.getScheme()))throw new IOException();String mime=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":path.endsWith(".webp")?"image/webp":"text/html";Map<String,String> h=new HashMap<>();h.put("Content-Security-Policy",CSP);h.put("Cache-Control","no-store");h.put("Referrer-Policy","no-referrer");return new WebResourceResponse(mime,"UTF-8",200,"OK",h,getAssets().open("web"+path));}catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}}
 });web.loadUrl(ORIGIN+"/");}
 @Override public void onBackPressed(){web.evaluateJavascript("document.querySelector('dialog[open] .modal-title button')?.click()",null);}
 @Override protected void onDestroy(){web.removeJavascriptInterface("QiliuAndroid");web.destroy();pool.shutdownNow();super.onDestroy();}
 private SecretKey key()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="qiliu-vault-v1";if(!ks.containsAlias(alias)){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}return (SecretKey)ks.getKey(alias,null);}
 private synchronized String read()throws Exception{File f=new File(getFilesDir(),"vault.bin");if(!f.exists())return "";byte[] all=Files.readAllBytes(f.toPath());Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(all,0,12)));return new String(c.doFinal(Arrays.copyOfRange(all,12,all.length)),StandardCharsets.UTF_8);}
 private synchronized void write(String value)throws Exception{if(value.length()>4000000)throw new IOException();Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());ByteArrayOutputStream bytes=new ByteArrayOutputStream();bytes.write(c.getIV());bytes.write(c.doFinal(value.getBytes(StandardCharsets.UTF_8)));File tmp=new File(getFilesDir(),"vault.tmp"),dest=new File(getFilesDir(),"vault.bin");Files.write(tmp.toPath(),bytes.toByteArray());Files.move(tmp.toPath(),dest.toPath(),StandardCopyOption.REPLACE_EXISTING);}
 private static boolean privateIP(InetAddress a){byte[] b=a.getAddress();return a.isAnyLocalAddress()||a.isLoopbackAddress()||a.isLinkLocalAddress()||a.isSiteLocalAddress()||a.isMulticastAddress()||(b.length==4&&(b[0]&255)==100&&((b[1]&255)>=64&&(b[1]&255)<=127))||(b.length==16&&(b[0]&0xfe)==0xfc);}
 private JSONObject http(JSONObject p)throws Exception{URL u=new URL(p.getString("url"));String kind=p.getString("kind");boolean qb=kind.equals("qb");if(u.getUserInfo()!=null||u.getRef()!=null)throw new IOException();InetAddress[] ips=InetAddress.getAllByName(u.getHost());for(InetAddress ip:ips){boolean local=privateIP(ip);if(!qb&&local)throw new IOException();}if(!u.getProtocol().equals("https")&&!(qb&&u.getProtocol().equals("http")))throw new IOException();
 if(kind.equals("mteam")&&(!Arrays.asList("api.m-team.cc","api.m-team.io").contains(u.getHost())||!Arrays.asList("/api/member/profile","/api/tracker/myPeerStatistics","/api/tracker/myPeerStatus","/api/tracker/mybonus","/api/torrent/search","/api/torrent/genDlToken").contains(u.getPath())))throw new IOException();
 if(kind.equals("tjupt")&&(!Arrays.asList("tjupt.org","www.tjupt.org").contains(u.getHost())||!Arrays.asList("/login.php","/takelogin.php","/usercp.php","/index.php","/userdetails.php","/mybonus.php","/getusertorrentlistajax.php","/torrents.php","/details.php","/download.php","/torrentrss.php").contains(u.getPath())))throw new IOException();
 if(!Arrays.asList("mteam","tjupt","rss","torrent","qb").contains(kind))throw new IOException();if(qb&&!Arrays.asList("/api/v2/auth/login","/api/v2/transfer/info","/api/v2/torrents/info","/api/v2/torrents/add","/api/v2/torrents/categories","/api/v2/app/defaultSavePath").stream().anyMatch(x->u.getPath().endsWith(x)))throw new IOException();
 HttpURLConnection c=(HttpURLConnection)u.openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);c.setRequestMethod(p.optString("method","GET"));c.setRequestProperty("User-Agent","Qiliu/0.3");JSONObject hs=p.optJSONObject("headers");if(hs!=null)for(Iterator<String> it=hs.keys();it.hasNext();){String k=it.next();if(Arrays.asList("Content-Type","x-api-key","Cookie","Origin","Referer").contains(k))c.setRequestProperty(k,hs.getString(k));}
 String body=p.optString("body","");String encoded=p.optString("bodyBase64","");if(!body.isEmpty()||!encoded.isEmpty()){c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write(encoded.isEmpty()?body.getBytes(StandardCharsets.UTF_8):Base64.decode(encoded,Base64.DEFAULT));}}int status=c.getResponseCode();InputStream in=status>=200&&status<300?c.getInputStream():c.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream();if(in!=null){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>4*1024*1024)throw new IOException();out.write(buf,0,n);}in.close();}JSONObject result=new JSONObject().put("status",status).put("body",kind.equals("torrent")?"":out.toString("UTF-8")).put("bodyBase64",kind.equals("torrent")?Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP):"").put("location",c.getHeaderField("Location")==null?"":c.getHeaderField("Location")).put("cookie",String.join(", ",c.getHeaderFields().getOrDefault("Set-Cookie",java.util.Collections.<String>emptyList())));c.disconnect();return result;}
 public class Bridge { @JavascriptInterface public void postMessage(String raw){pool.execute(()->{String id="";JSONObject result=new JSONObject();try{JSONObject p=new JSONObject(raw);id=p.getString("id");Object value;switch(p.getString("action")){case "read":value=read();break;case "write":write(p.getString("value"));value=true;break;case "http":value=http(p);break;default:throw new IOException();}result.put("value",value);}catch(Exception e){try{String message="设备连接或安全存储失败，请检查地址、网络与权限。";
if(e instanceof UnknownHostException)message="地址无法解析，请检查域名或 IPv6 格式。";
else if(e instanceof SocketTimeoutException)message="连接超时；请检查手机 IPv6 网络、NAS 端口和防火墙。";
else if(e instanceof ConnectException||e instanceof NoRouteToHostException)message="无法到达下载器，请检查地址、端口及手机网络。";
else if(e instanceof javax.net.ssl.SSLException)message="HTTPS 证书校验失败；HTTP 服务请填写 http:// 地址。";
result.put("error",message);}catch(Exception ignored){}}final String js="window.__qiliuReply("+JSONObject.quote(id)+","+result.toString()+")";runOnUiThread(()->{if(!isFinishing())web.evaluateJavascript(js,null);});});}}
}
