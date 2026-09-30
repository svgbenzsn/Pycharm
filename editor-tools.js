(function(root) {
  function newline(text, position) {
    const before = text.slice(0,position);
    const line = before.slice(before.lastIndexOf("\n")+1);
    const indent = (line.match(/^[ \t]*/)||[""])[0];
    let quote=null, triple=false, escaped=false, comment=false, clean="", stack=[];
    for(let i=0;i<before.length;i++){
      const c=before[i];
      if(comment){if(c==="\n"){comment=false;clean+="\n";}continue;}
      if(quote){
        if(escaped){escaped=false;continue;}
        if(c==="\\"){escaped=true;continue;}
        if(triple&&before.slice(i,i+3)===quote.repeat(3)){quote=null;triple=false;i+=2;}
        else if(!triple&&c===quote)quote=null;
        continue;
      }
      if(c==="#"){comment=true;continue;}
      if(c==="'"||c==='"'){quote=c;triple=before.slice(i,i+3)===c.repeat(3);if(triple)i+=2;clean+="x";continue;}
      clean+=c;
      if("([{".includes(c))stack.push(c);
      if(")]}".includes(c))stack.pop();
    }
    if(quote) return "\n"+indent;
    const current=clean.slice(clean.lastIndexOf("\n")+1).trimEnd();
    const extra=current.endsWith(":") || /[([{]\s*$/.test(current);
    return "\n"+indent+(extra?"    ":"");
  }
  function packages(value) {
    const items=value.split(/[\s,]+/).filter(Boolean);
    if(items.length>30)throw Error("Можно выбрать до 30 библиотек.");
    if(items.some(p=>! /^[A-Za-z0-9][A-Za-z0-9._-]*(?:==[A-Za-z0-9][A-Za-z0-9.!+_-]*)?$/.test(p)))
      throw Error("Укажи название пакета, например numpy или numpy==2.3.0.");
    return [...new Set(items)];
  }
  const api={newline,packages};
  if(typeof module==="object")module.exports=api;
  else root.EditorTools=api;
})(globalThis);
