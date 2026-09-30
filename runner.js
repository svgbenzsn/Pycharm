const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
self.onmessage = async event => {
  if (event.data?.type !== "run") return;
  const {files,active,input,packages=[]} = event.data;
  try {
    const {loadPyodide} = await import(PYODIDE_URL + "pyodide.mjs");
    const pyodide = await loadPyodide({indexURL:PYODIDE_URL});
    const project = "/home/pyodide/project";
    pyodide.FS.mkdirTree(project);
    for (const file of files) {
      if (typeof file.name!=="string" || file.name.length>120 || /[/\\\\\x00-\x1f]/.test(file.name) || file.name.startsWith(".") || !/\.(py|txt|csv|json|tsv)$/i.test(file.name)) throw new Error("Недопустимое имя файла.");
      pyodide.FS.writeFile(project + "/" + file.name,file.code,{encoding:"utf8"});
    }
    pyodide.FS.chdir(project);
    pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide/project')");
    const lines = input === "" ? [] : input.replace(/\r\n/g,"\n").split("\n");
    let index = 0;
    pyodide.setStdin({stdin:()=> index < lines.length ? lines[index++] : undefined});
    function streamWriter(error) {
      const decoder = new TextDecoder();
      return {write(bytes) {
        const text = decoder.decode(bytes,{stream:true});
        if (text) self.postMessage({type:"stream",text,error});
        return bytes.length;
      }};
    }
    pyodide.setStdout(streamWriter(false));
    pyodide.setStderr(streamWriter(true));

    // The exact editor snapshot is executed. No formatting or writeback.
    const source = files.find(f=>f.name===active)?.code;
    if (source === undefined || !/\.py$/i.test(active)) throw new Error("Активный файл не найден.");
    if(packages.length){
      if(!Array.isArray(packages) || packages.length>30 || packages.some(p=>typeof p!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:==[A-Za-z0-9][A-Za-z0-9.!+_-]*)?$/.test(p)))
        throw Error("Некорректный список библиотек.");
      self.postMessage({type:"status",text:"Установка библиотек…"});
      await pyodide.loadPackage("micropip");
      const micropip=pyodide.pyimport("micropip");
      try {await micropip.install(packages);} finally {micropip.destroy();}
    }
    self.postMessage({type:"status",text:"Проверка импортов…"});
    for(const file of files){
      if(!/\.py$/i.test(file.name))continue;
      try {await pyodide.loadPackagesFromImports(file.code);}
      catch(error){
        if(file.name===active || !String(error).includes("SyntaxError"))throw error;
      }
    }
    self.postMessage({type:"ready"});
    await pyodide.runPythonAsync(source);
    self.postMessage({type:"done"});
  } catch (error) {
    self.postMessage({type:"error",text:String(error?.message || error)});
  }
};
