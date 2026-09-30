(() => {
  "use strict";
  const STORAGE_KEY = "ipad-python-ide-v1";
  const DEFAULT_CODE = '# Здесь твой Python-код\nprint("Привет, мир!")\n';
  const $ = id => document.getElementById(id);
  const ui = {
    files: $("files"), code: $("code"), numbers: $("line-numbers"),
    filename: $("filename"), position: $("cursor-position"), output: $("output"),
    runtime: $("runtime-state"), status: $("save-status"), input: $("stdin"),
    run: $("run"), stop: $("stop"), dialog: $("file-dialog"),
    name: $("file-name"), dialogTitle: $("dialog-title"),
    dialogConfirm: $("dialog-confirm"), dialogError: $("dialog-error")
  };
  const initial = () => ({files: [{name:"main.py",code:DEFAULT_CODE}], active:"main.py", input:"", packages:[], autoindent:true, softwrap:false, editorSettingsVersion:2});
  let state = initial();
  let worker = null, generation = 0, busy = false, outputLength = 0, outputTruncated = false;
  let saved = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.files) && parsed.files.length &&
          parsed.files.length <= 100 &&
          parsed.files.every(f => f && validName(f.name) && typeof f.code === "string" && f.code.length < 2000000) &&
          new Set(parsed.files.map(f => f.name)).size === parsed.files.length) {
        state = {files:parsed.files,active:parsed.files.some(f=>f.name===parsed.active)?parsed.active:parsed.files[0].name,input:typeof parsed.input==="string"?parsed.input:"", packages:Array.isArray(parsed.packages)?parsed.packages.filter(p=>typeof p==="string"):[], autoindent:parsed.editorSettingsVersion===2?parsed.autoindent!==false:true, softwrap:parsed.editorSettingsVersion===2&&parsed.softwrap===true, editorSettingsVersion:2};
      }
    }
  } catch (_) {
    saved = false;
  }
  function validName(name) {
    return typeof name === "string" && name.length <= 120 && !/[/\\\\\x00-\x1f]/.test(name) && !name.startsWith(".") && /\.(py|txt|csv|json|tsv)$/i.test(name);
  }
  function activeFile() {return state.files.find(f => f.name === state.active);}
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saved = true;
      ui.status.textContent = "Сохранено на iPad";
    } catch (_) {
      saved = false;
      ui.status.textContent = "Не сохранено — скачай файл";
    }
  }
  function renderFiles() {
    ui.files.replaceChildren();
    state.files.forEach(file => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "file" + (file.name === state.active ? " active" : "");
      button.setAttribute("role","listitem"); button.setAttribute("aria-label",file.name);
      const icon = document.createElement("span"); icon.className = "py"; icon.textContent = /\.py$/i.test(file.name) ? "Py" : "≡";
      const label = document.createElement("span"); label.textContent = file.name;
      button.append(icon,label);
      button.addEventListener("click", () => selectFile(file.name));
      ui.files.append(button);
    });
    ui.filename.textContent = state.active;
    ui.run.disabled=busy || !/\.py$/i.test(state.active);
  }
  function renderEditor() {
    ui.code.value = activeFile().code;
    ui.code.scrollTop = 0; ui.code.scrollLeft = 0;
    updateNumbers(); updatePosition();
  }
  function selectFile(name) {
    if (name === state.active) return;
    state.active = name;
    save(); renderFiles(); renderEditor();
  }
  let mirror;
  function updateNumbers() {
    const lines=ui.code.value.split("\n").slice(0,20000);
    if (state.softwrap && typeof getComputedStyle === "function") {
      if(!mirror){mirror=document.createElement("div");mirror.className="editor-mirror";document.body.append(mirror);}
      const style=getComputedStyle(ui.code);
      mirror.style.font=style.font;
      mirror.style.lineHeight=style.lineHeight;
      mirror.style.width=Math.max(1,ui.code.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))+"px";
      ui.numbers.replaceChildren();
      lines.forEach((line,i)=>{
        mirror.textContent=line || " ";
        const n=document.createElement("div");n.textContent=String(i+1);
        n.style.height=mirror.getBoundingClientRect().height+"px";
        ui.numbers.append(n);
      });
    } else {
      ui.numbers.textContent=lines.map((_,i)=>i+1).join("\n");
    }
    ui.numbers.scrollTop = ui.code.scrollTop;
  }
  function updatePosition() {
    const before = ui.code.value.slice(0,ui.code.selectionStart);
    const lines = before.split("\n");
    ui.position.textContent = "Строка " + lines.length + ", столбец " + (lines.at(-1).length+1);
  }
  let pendingNativeBreak = null;
  function placeCaret(position) {
    ui.code.setSelectionRange(position,position);
    ui.code.scrollLeft=0;
    if(!state.softwrap && typeof getComputedStyle==="function"){
      const lineHeight=parseFloat(getComputedStyle(ui.code).lineHeight);
      const row=ui.code.value.slice(0,position).split("\n").length-1;
      const top=row*lineHeight;
      if(top<ui.code.scrollTop)ui.code.scrollTop=top;
      else if(top+lineHeight>ui.code.scrollTop+ui.code.clientHeight)
        ui.code.scrollTop=top+lineHeight-ui.code.clientHeight+18;
    }
  }
  ui.code.addEventListener("input", () => {
    if(pendingNativeBreak){
      const snapshot=pendingNativeBreak;
      pendingNativeBreak=null;
      const expected=snapshot.before+"\n"+snapshot.after;
      // Only complete the matching native Return; never rewrite pasted text.
      if(ui.code.value===expected){
        const position=snapshot.before.length+1;
        ui.code.setRangeText(snapshot.indent,position,position,"end");
        placeCaret(position+snapshot.indent.length);
      }
    }
    activeFile().code = ui.code.value; // Only a direct editor input changes source text.
    save(); updateNumbers(); updatePosition();
  });
  ui.code.addEventListener("scroll", () => {ui.numbers.scrollTop = ui.code.scrollTop;});
  ["click","keyup","select"].forEach(event => ui.code.addEventListener(event,updatePosition));
  function insertNewline() {
    const start=ui.code.selectionStart, end=ui.code.selectionEnd;
    const text=EditorTools.newline(ui.code.value,start);
    pendingNativeBreak=null;
    ui.code.setRangeText(text,start,end,"end");
    placeCaret(start+text.length);
    ui.code.dispatchEvent(new Event("input",{bubbles:true}));
  }
  ui.code.addEventListener("beforeinput",event=>{
    pendingNativeBreak=null;
    const isReturn=event.inputType==="insertLineBreak" || event.inputType==="insertParagraph";
    if(!state.autoindent || event.isComposing || !isReturn)return;
    if(event.cancelable===false){
      const start=ui.code.selectionStart,end=ui.code.selectionEnd;
      pendingNativeBreak={
        before:ui.code.value.slice(0,start),after:ui.code.value.slice(end),
        indent:EditorTools.newline(ui.code.value,start).slice(1)
      };
      return;
    }
    event.preventDefault();insertNewline();
  });
  ui.code.addEventListener("keydown", event => {
    if(event.key==="Enter" && state.autoindent && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey){
      event.preventDefault();insertNewline();return;
    }
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      ui.code.setRangeText("    ",ui.code.selectionStart,ui.code.selectionEnd,"end");
      ui.code.dispatchEvent(new Event("input",{bubbles:true}));
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault(); save();
    }
  });
  ui.input.value = state.input;
  ui.input.addEventListener("input", () => {state.input = ui.input.value; save();});

  $("autoindent").checked=state.autoindent;
  $("softwrap").checked=state.softwrap;
  function applyWrap(){
    ui.code.wrap=state.softwrap?"soft":"off";
    ui.code.classList.toggle("softwrap",state.softwrap);
    updateNumbers();
  }
  $("autoindent").addEventListener("change",()=>{state.autoindent=$("autoindent").checked;save();});
  $("softwrap").addEventListener("change",()=>{state.softwrap=$("softwrap").checked;applyWrap();save();});
  if(typeof ResizeObserver==="function")new ResizeObserver(updateNumbers).observe(ui.code);
  $("libraries").addEventListener("click",()=>{
    $("package-list").value=state.packages.join("\n");
    $("package-error").textContent="";$("libraries-dialog").returnValue="cancel";$("libraries-dialog").showModal();
  });
  $("libraries-dialog").addEventListener("close",()=>{
    if($("libraries-dialog").returnValue!=="confirm")return;
    try{state.packages=EditorTools.packages($("package-list").value);save();}
    catch(error){$("package-error").textContent=error.message;$("libraries-dialog").returnValue="cancel";$("libraries-dialog").showModal();}
  });
  $("upload-files").addEventListener("click",()=>{$("file-picker").click();});
  $("file-picker").addEventListener("change",async()=>{
    const selected=Array.from($("file-picker").files || []);
    $("file-picker").value="";
    if(!selected.length)return;
    $("upload-files").disabled=true;
    const errors=[];let count=0,firstPython=null;
    for(const file of selected){
      try {
        if(!validName(file.name))throw Error("нужно расширение .py, .txt, .csv, .json или .tsv и имя без /");
        if(file.size>1024*1024)throw Error("размер больше 1 МБ");
        const bytes=await file.arrayBuffer();
        const code=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        if(code.includes("\u0000"))throw Error("двоичный файл не поддерживается");
        const existing=state.files.find(f=>f.name===file.name);
        if(!existing && state.files.length>=100)throw Error("не больше 100 файлов в проекте");
        const total=state.files.reduce((n,f)=>n+(f.name===file.name?0:new TextEncoder().encode(f.code).length),0)+bytes.byteLength;
        if(total>2*1024*1024)throw Error("общий размер проекта больше 2 МБ");
        if(existing && !confirm("Файл "+file.name+" уже есть. Заменить его содержимое?"))continue;
        if(existing)existing.code=code;else state.files.push({name:file.name,code});
        if(!firstPython && /\.py$/i.test(file.name))firstPython=file.name;
        count++;
      }catch(error){errors.push(file.name+": "+(error.name==="TypeError"?"нужна кодировка UTF-8":error.message));}
    }
    if(firstPython)state.active=firstPython;
    if(count){save();renderFiles();renderEditor();}
    $("upload-status").textContent=(count?"Загружено: "+count+". Данные читай через open(имя файла). ":"")+
      (errors.length?errors.join("; "):(!count?"Загрузка отменена.":""))+(!saved?" Не удалось сохранить в браузере. Скачай важные файлы.":"");
    $("upload-files").disabled=false;
  });
  let dialogMode = "new";
  function openDialog(mode) {
    dialogMode = mode; ui.dialogError.textContent = "";
    ui.dialogTitle.textContent = mode === "new" ? "Новый файл" : "Переименовать файл";
    ui.dialogConfirm.textContent = mode === "new" ? "Создать" : "Сохранить";
    ui.name.value = mode === "new" ? "" : state.active;
    ui.dialog.returnValue="cancel"; ui.dialog.showModal(); ui.name.focus();
  }
  $("new-file").addEventListener("click",()=>openDialog("new"));
  $("rename").addEventListener("click",()=>openDialog("rename"));
  ui.dialog.addEventListener("close", () => {
    if (ui.dialog.returnValue !== "confirm") return;
    const name = ui.name.value.trim();
    if (!validName(name)) { ui.dialogError.textContent = "Укажи имя без / и \\, с расширением .py, .txt, .csv, .json или .tsv"; ui.dialog.returnValue="cancel"; ui.dialog.showModal(); return; }
    if (state.files.some(f => f.name === name && (dialogMode === "new" || name !== state.active))) {
      ui.dialogError.textContent = "Файл с таким именем уже есть."; ui.dialog.returnValue="cancel"; ui.dialog.showModal(); return;
    }
    if (dialogMode === "new") {
      state.files.push({name,code:""}); state.active = name;
    } else {activeFile().name = name; state.active = name;}
    save(); renderFiles(); renderEditor(); ui.code.focus();
  });
  $("remove").addEventListener("click", () => {
    if (state.files.length === 1) {alert("Нельзя удалить последний файл. Создай новый файл перед удалением.");return;}
    if (!confirm("Удалить " + state.active + "? Это действие нельзя отменить.")) return;
    state.files = state.files.filter(f=>f.name !== state.active);
    state.active = state.files[0].name;
    save(); renderFiles(); renderEditor();
  });
  $("download").addEventListener("click", () => {
    const file = activeFile();
    const url = URL.createObjectURL(new Blob([file.code],{type:"text/plain;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  function setBusy(value,label) {
    busy = value; ui.run.disabled = value || !/\.py$/i.test(state.active); ui.stop.disabled = !value;
    ui.runtime.textContent = label;
  }
  function appendOutput(value,error=false) {
    if (outputTruncated) return;
    const text = String(value);
    if (outputLength + text.length > 300000) {
      const remaining = Math.max(0,300000-outputLength);
      ui.output.append(document.createTextNode(text.slice(0,remaining) + "\n…Вывод сокращён."));
      outputTruncated = true;
    } else {ui.output.append(document.createTextNode(text)); outputLength += text.length;}
    if (error) ui.output.classList.add("error");
    ui.output.scrollTop = ui.output.scrollHeight;
  }
  function stopRun() {
    generation++;
    if (worker) {worker.terminate();worker=null;}
    if (busy) appendOutput("\n■ Выполнение остановлено.\n");
    setBusy(false,"Остановлено");
  }
  $("stop").addEventListener("click",stopRun);
  $("clear").addEventListener("click",()=>{ui.output.replaceChildren();ui.output.classList.remove("error");outputLength=0;outputTruncated=false;});
  $("run").addEventListener("click", () => {
    if (busy || !/\.py$/i.test(state.active)) return;
    const currentGeneration = ++generation;
    ui.output.replaceChildren();ui.output.classList.remove("error");outputLength=0;outputTruncated=false;
    setBusy(true,"Загрузка Python…");
    try {
      // A fresh worker also makes Stop reliable for loops and resets Python globals.
      worker = new Worker("./runner.js?v=upload-files-1",{type:"module"});
      worker.onmessage = event => {
        if (currentGeneration !== generation) return;
        const msg = event.data;
        if (msg.type === "status") {ui.runtime.textContent=msg.text;return;}
        if (msg.type === "ready") {ui.runtime.textContent = "Выполняется…"; return;}
        if (msg.type === "stream") {appendOutput(msg.text,msg.error);return;}
        if (msg.type === "error") {appendOutput(msg.text + "\n",true);}
        if (msg.type === "done" || msg.type === "error") {
          setBusy(false,msg.type === "error" ? "Ошибка выполнения" : "Готово");
          worker.terminate();worker=null;
        }
      };
      worker.onerror = event => {
        if (currentGeneration !== generation) return;
        appendOutput("Не удалось запустить Python. Проверь интернет и обнови страницу.\n" + (event.message || "") + "\n",true);
        setBusy(false,"Ошибка загрузки");worker.terminate();worker=null;
      };
      const files = state.files.map(({name,code})=>({name,code}));
      worker.postMessage({type:"run",files,active:state.active,input:ui.input.value,packages:state.packages});
    } catch (error) {
      appendOutput("Браузер не поддерживает запуск Python: " + error.message + "\n",true);
      setBusy(false,"Ошибка запуска");
    }
  });
  renderFiles();renderEditor();applyWrap();
  if (!saved) ui.status.textContent = "Сохранение недоступно — скачай файл";
  if (document.modelContext?.registerTool) {
    const schema = {type:"object",properties:{},additionalProperties:false};
    const validate = input => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) {
        throw Error("Ожидался пустой объект параметров.");
      }
    };
    for (const tool of [
      {name:"read_current_python_file",title:"Прочитать текущий файл",
       description:"Возвращает точный текст открытого Python-файла без изменений.",
       inputSchema:schema,annotations:{readOnlyHint:true,untrustedContentHint:true},
       execute:input=>{validate(input);return {name:state.active,code:activeFile().code};}},
      {name:"start_python_execution",title:"Запустить Python-файл",
       description:"Запускает открытый файл и показывает результат в консоли; исходный текст не меняется.",
       inputSchema:schema,annotations:{readOnlyHint:false,untrustedContentHint:true},
       execute:input=>{validate(input);if(busy) throw Error("Python уже выполняется");if(!/\.py$/i.test(state.active))throw Error("Выбери файл .py");ui.run.click();return {name:state.active,status:"started"};}}
    ]) {
      try {Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});} catch (_) {}
    }
  }
})();
