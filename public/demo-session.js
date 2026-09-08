let starting;
export function ensureDemo(reset=false){
  if(!starting||reset)starting=fetch('/api/demo/'+(reset?'reset':'start'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(async response=>{
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Не удалось открыть тестовый кабинет.');
    return result;
  }).catch(error=>{starting=undefined;throw error;});
  return starting;
}
