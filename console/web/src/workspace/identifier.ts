/**
 * Derive a flat identifier (^[a-z][a-z0-9_]*$) from a human title:
 * "Maximum Exports" → "maximum_exports", "Accès API" → "acces_api".
 * Accents are dropped, every run of other characters becomes one underscore,
 * and an identifier that would not start with a letter gets `${prefix}_`.
 */
export function identifierFromTitle(title:string,prefix:string,maxLength=80):string{
 const stem=title.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
 if(!stem)return '';
 return (/^[a-z]/.test(stem)?stem:`${prefix}_${stem}`).slice(0,maxLength).replace(/_+$/,'');
}

/** An identifier from a title, unique among the taken ones (at most 80 characters). */
export function uniqueIdentifier(title:string,prefix:string,taken:readonly string[]):string{
  const base=identifierFromTitle(title,prefix)||prefix;let id=base,n=1;
  while(taken.includes(id)){const tail=`_${n++}`;id=base.slice(0,80-tail.length).replace(/_+$/,"")+tail;}
  return id;
}

/** A variant name from its tier's name, shortened so that it stays within the 200-character limit. */
export function variantName(tierName:string,suffix:string){
  const tail=` ${suffix}`;return tierName.trim().slice(0,200-tail.length).trimEnd()+tail;
}
