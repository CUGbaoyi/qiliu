import Cocoa
import WebKit
import Security
import CryptoKit
import Darwin

func failure(_ message:String)->NSError { NSError(domain:"Qiliu",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
final class Vault {
 let dir:URL
 init(){dir=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Qiliu")}
 func key() throws -> SymmetricKey {
 let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"cc.qiliu.desktop",kSecAttrAccount as String:"vault-key"]
 var find=query;find[kSecReturnData as String]=true;var found:CFTypeRef?
 let status=SecItemCopyMatching(find as CFDictionary,&found)
 if status==errSecSuccess,let data=found as? Data{return SymmetricKey(data:data)}
 guard status==errSecItemNotFound else {throw failure("无法读取 macOS 钥匙串。")}
 var bytes=[UInt8](repeating:0,count:32);guard SecRandomCopyBytes(kSecRandomDefault,32,&bytes)==errSecSuccess else{throw failure("无法生成本机密钥。")}
 let data=Data(bytes);var add=query;add[kSecValueData as String]=data;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
 guard SecItemAdd(add as CFDictionary,nil)==errSecSuccess else{throw failure("无法保存到 macOS 钥匙串。")};return SymmetricKey(data:data)
 }
 func read() throws -> String {let url=dir.appendingPathComponent("vault.enc");if !FileManager.default.fileExists(atPath:url.path){return ""};return String(data:try AES.GCM.open(AES.GCM.SealedBox(combined:Data(contentsOf:url)),using:key()),encoding:.utf8) ?? ""}
 func write(_ value:String)throws {guard value.utf8.count<4000000 else{throw failure("本机数据过大。")};try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]);let bytes=try AES.GCM.seal(Data(value.utf8),using:key()).combined!;let url=dir.appendingPathComponent("vault.enc");try bytes.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)}
}
func privateHost(_ host:String)throws->Bool {
 var hints=addrinfo();hints.ai_socktype=SOCK_STREAM;hints.ai_family=AF_UNSPEC;var res:UnsafeMutablePointer<addrinfo>?
 guard getaddrinfo(host.trimmingCharacters(in:CharacterSet(charactersIn:"[]")),nil,&hints,&res)==0,let first=res else{throw failure("域名无法解析。")};defer{freeaddrinfo(first)}
 var cursor:UnsafeMutablePointer<addrinfo>?=first;var allPrivate=true
 while let p=cursor {let addr=p.pointee;var text=[CChar](repeating:0,count:Int(NI_MAXHOST));guard getnameinfo(addr.ai_addr,addr.ai_addrlen,&text,socklen_t(text.count),nil,0,NI_NUMERICHOST)==0 else{throw failure("无法解析地址。")};let ip=String(cString:text);var local=false
 if ip.contains(":"){local=ip=="::1"||ip=="::"||ip.hasPrefix("fc")||ip.hasPrefix("fd")||ip.hasPrefix("fe80")||ip.hasPrefix("ff")||ip.hasPrefix("::ffff:")}else{let b=ip.split(separator:".").compactMap{Int($0)};if b.count==4{local=b[0]==10||b[0]==127||b[0]==0||b[0]>=224||(b[0]==192&&b[1]==168)||(b[0]==172&&(16...31).contains(b[1]))||(b[0]==169&&b[1]==254)||(b[0]==100&&(64...127).contains(b[1]))}}
 allPrivate = allPrivate && local;cursor=addr.ai_next
 };return allPrivate
}
final class HTTPJob:NSObject,URLSessionDataDelegate,URLSessionTaskDelegate {
 var bytes=Data();var response:HTTPURLResponse?;var session:URLSession!;let binary:Bool;let done:([String:Any])->Void
 init(request:URLRequest,binary:Bool=false,done:@escaping([String:Any])->Void){self.done=done;self.binary=binary;super.init();let c=URLSessionConfiguration.ephemeral;c.httpShouldSetCookies=false;c.httpCookieStorage=nil;c.urlCache=nil;c.timeoutIntervalForRequest=15;c.timeoutIntervalForResource=30;session=URLSession(configuration:c,delegate:self,delegateQueue:nil);session.dataTask(with:request).resume()}
 func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
 func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void){self.response=response as? HTTPURLResponse;completionHandler(response.expectedContentLength>4194304 ? .cancel:.allow)}
 func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data){bytes.append(data);if bytes.count>4194304{dataTask.cancel()}}
 func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){defer{session.finishTasksAndInvalidate()};guard error==nil,let r=response else{done(["error":"连接失败，请检查站点地址、网络或证书。"]);return};done(["value":["status":r.statusCode,"body":binary ? "" : (String(data:bytes,encoding:.utf8) ?? ""),"bodyBase64":binary ? bytes.base64EncodedString() : "","location":r.value(forHTTPHeaderField:"Location") ?? "","cookie": (r.allHeaderFields.filter{String(describing:$0.key).lowercased()=="set-cookie"}.flatMap{($0.value as? [String]) ?? [String(describing:$0.value)]}).joined(separator:", ")]])}
}
final class AppDelegate:NSObject,NSApplicationDelegate,WKScriptMessageHandler,WKURLSchemeHandler,WKNavigationDelegate,WKUIDelegate {
 var window:NSWindow!;var web:WKWebView!;let vault=Vault();let storage=DispatchQueue(label:"qiliu.storage")
 func applicationDidFinishLaunching(_ notification:Notification){
 let menu=NSMenu();let item=NSMenuItem();menu.addItem(item);let appMenu=NSMenu();appMenu.addItem(withTitle:"退出栖流",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");item.submenu=appMenu;let edit=NSMenuItem();menu.addItem(edit);let em=NSMenu(title:"编辑");for (title,action,key) in [("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{em.addItem(withTitle:title,action:Selector(action),keyEquivalent:key)};edit.submenu=em;NSApplication.shared.mainMenu=menu
 let c=WKWebViewConfiguration();c.setURLSchemeHandler(self,forURLScheme:"qiliu");c.userContentController.add(self,name:"qiliu");web=WKWebView(frame:.zero,configuration:c);web.navigationDelegate=self;web.uiDelegate=self
 window=NSWindow(contentRect:NSRect(x:0,y:0,width:1320,height:960),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false);window.title="栖流";window.minSize=NSSize(width:390,height:620);window.contentView=web;window.center();window.makeKeyAndOrderFront(nil);NSApplication.shared.activate(ignoringOtherApps:true);web.load(URLRequest(url:URL(string:"qiliu://app/index.html")!))
 }
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
 func webView(_ webView:WKWebView,start urlSchemeTask:WKURLSchemeTask){do{guard let u=urlSchemeTask.request.url,u.host=="app",!u.path.contains(".."),let root=Bundle.main.resourceURL?.appendingPathComponent("web") else{throw failure("无效资源")};let path=u.path=="/" ? "index.html":String(u.path.dropFirst());let f=root.appendingPathComponent(path).standardizedFileURL;guard f.path.hasPrefix(root.path+"/") else{throw failure("无效资源")};let d=try Data(contentsOf:f);let mime=path.hasSuffix(".js") ? "text/javascript":path.hasSuffix(".css") ? "text/css":path.hasSuffix(".png") ? "image/png":path.hasSuffix(".webp") ? "image/webp":"text/html";urlSchemeTask.didReceive(URLResponse(url:u,mimeType:mime,expectedContentLength:d.count,textEncodingName:"utf-8"));urlSchemeTask.didReceive(d);urlSchemeTask.didFinish()}catch{urlSchemeTask.didFailWithError(error)}}
 func webView(_ webView:WKWebView,stop urlSchemeTask:WKURLSchemeTask){}
 func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let u=navigationAction.request.url else{decisionHandler(.cancel);return};if u.scheme=="qiliu"&&u.host=="app"{decisionHandler(.allow)}else{if u.scheme=="https"{NSWorkspace.shared.open(u)};decisionHandler(.cancel)}}
 func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{if let u=navigationAction.request.url,u.scheme=="https"{NSWorkspace.shared.open(u)};return nil}
 func reply(_ id:String,_ result:[String:Any]){DispatchQueue.main.async{let values:[Any]=[id,result];guard let d=try? JSONSerialization.data(withJSONObject:values,options:[.fragmentsAllowed]),let json=String(data:d,encoding:.utf8) else{return};self.web.evaluateJavaScript("window.__qiliuReply(...\(json))",completionHandler:nil)}}
 func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){guard message.frameInfo.isMainFrame,message.frameInfo.request.url?.scheme=="qiliu",let raw=message.body as? String,let data=raw.data(using:.utf8),let p=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let id=p["id"] as? String,let action=p["action"] as? String else{return}
 if action=="read"||action=="write"{storage.async{do{if action=="read"{self.reply(id,["value":try self.vault.read()])}else{guard let v=p["value"] as? String else{throw failure("无效数据")};try self.vault.write(v);self.reply(id,["value":true])}}catch{self.reply(id,["error":error.localizedDescription])}};return}
 guard action=="http" else{reply(id,["error":"不支持的操作"]);return};DispatchQueue.global().async{do{guard let rawURL=p["url"] as? String,let u=URL(string:rawURL),let host=u.host,u.user==nil,u.password==nil,u.fragment==nil,let kind=p["kind"] as? String,["mteam","tjupt","rss","torrent","qb"].contains(kind) else{throw failure("无效地址")};let isPrivate=try privateHost(host);let qb=kind=="qb";guard (u.scheme=="https"||(qb&&u.scheme=="http"))&&(qb || !isPrivate) else{throw failure("站点与 RSS 需要 HTTPS；下载器支持 HTTP 和 HTTPS。")}
 if kind=="mteam"{guard ["api.m-team.cc","api.m-team.io"].contains(host),["/api/member/profile","/api/tracker/myPeerStatistics","/api/tracker/myPeerStatus","/api/tracker/mybonus","/api/torrent/search","/api/torrent/genDlToken"].contains(u.path) else{throw failure("无效 M-Team 操作")}}
 if kind=="tjupt"{guard ["tjupt.org","www.tjupt.org"].contains(host),["/login.php","/takelogin.php","/usercp.php","/index.php","/userdetails.php","/mybonus.php","/getusertorrentlistajax.php","/torrents.php","/details.php","/download.php","/torrentrss.php"].contains(u.path) else{throw failure("无效 TJUPT 操作")}}
 if qb{guard ["/api/v2/auth/login","/api/v2/transfer/info","/api/v2/torrents/info","/api/v2/torrents/add","/api/v2/torrents/categories","/api/v2/app/defaultSavePath"].contains(where:{u.path.hasSuffix($0)}) else{throw failure("不支持的下载器操作")}}
 var r=URLRequest(url:u);r.httpMethod=p["method"] as? String ?? "GET";r.setValue("Qiliu/0.3",forHTTPHeaderField:"User-Agent");if let headers=p["headers"] as? [String:String]{for(k,v)in headers where ["Content-Type","x-api-key","Cookie","Origin","Referer"].contains(k){r.setValue(v,forHTTPHeaderField:k)}};if let body=p["body"] as? String,!body.isEmpty{r.httpBody=body.data(using:.utf8)};if let encoded=p["bodyBase64"] as? String,!encoded.isEmpty{guard let bytes=Data(base64Encoded:encoded),bytes.count<4259840 else{throw failure("种子数据无效")};r.httpBody=bytes};_ = HTTPJob(request:r,binary:kind=="torrent"){result in self.reply(id,result)}
 }catch{self.reply(id,["error":error.localizedDescription])}}
 }
}
let app=NSApplication.shared;let delegate=AppDelegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run()
