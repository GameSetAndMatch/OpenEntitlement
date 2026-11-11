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
