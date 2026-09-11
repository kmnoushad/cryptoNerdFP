(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RoundTransport=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  function create(options){
    const fetcher=options.fetch||fetch;
    async function request(path,init={},retry=true){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),options.timeout||15000);
      let response;
      try{
        response=await fetcher(options.url+path,{...init,signal:controller.signal,
          headers:{apikey:options.key,Authorization:'Bearer '+options.getToken(),...init.headers}});
        if(response.status===401&&retry){
          clearTimeout(timer);
          if(await options.refresh())return request(path,init,false);
          throw new Error('Session expired. Please sign in again.');
        }
        const text=await response.text();
        let data=null;
        try{data=text?JSON.parse(text):null;}catch(e){throw new Error('Invalid server response');}
        if(!response.ok){const error=new Error(data&&data.message||'Request failed ('+response.status+')');error.status=response.status;error.code=data&&data.code;throw error;}
        return {data,range:response.headers.get('content-range')};
      }catch(error){
        if(error.name==='AbortError')throw new Error('Request timed out. Refresh to check whether a save completed.');
        throw error;
      }finally{clearTimeout(timer);}
    }
    async function list(date){
      let rows=[];
      for(let offset=0;offset<=2600;){
        let result;
        try{result=await request('/rest/v1/rounds?play_date=eq.'+encodeURIComponent(date)+'&order=round_number.asc,id.asc&offset='+offset+'&limit=200',
          {headers:{Prefer:'count=exact'}});
        }catch(error){if(error.status===416&&offset>0)return rows;throw error;}
        if(!Array.isArray(result.data))throw new Error('Invalid round response');
        const page=result.data;
        rows=rows.concat(page);offset+=page.length;
        const match=(result.range||'').match(/\/(\d+)$/),total=match?Number(match[1]):null;
        if(total!==null&&offset>=total)return rows;
        if(!page.length){if(total!==null&&offset<total)throw new Error('Incomplete round response');return rows;}
      }
      throw new Error('Too many rows; check duplicate round numbers');
    }
    return {request,list};
  }
  return {create};
});
