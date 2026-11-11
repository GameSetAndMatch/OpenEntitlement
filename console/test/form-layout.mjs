/**
 * Layout rules every console form must keep (see web/UI-GUIDELINES.md).
 * Run against a rendered page; throws with every violation found.
 */
export async function assertFormLayout(page,selector='form.form'){
 const problems=await page.evaluate(sel=>{
  const out=[],forms=[...document.querySelectorAll(sel)];
  if(!forms.length)return [`no element matches ${sel}`];
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
  const describe=el=>el.outerHTML.slice(0,80);
  for(const form of forms){
   if(form.scrollWidth>form.clientWidth+1)out.push(`form overflows horizontally by ${form.scrollWidth-form.clientWidth}px`);
   for(const control of form.querySelectorAll('input,select,textarea')){
    if(!visible(control))continue;
    if(!(control.labels?.length||control.getAttribute('aria-label')||control.getAttribute('aria-labelledby')))out.push(`unlabelled control ${describe(control)}`);
    const r=control.getBoundingClientRect(),f=form.getBoundingClientRect();
    if(r.right>f.right+1||r.left<f.left-1)out.push(`control outside its form ${describe(control)}`);
   }
   for(const box of form.querySelectorAll('input[type=checkbox],input[type=radio]')){
    if(!visible(box))continue;
    const r=box.getBoundingClientRect(),label=box.labels?.[0];
    if(r.width>24||r.height>24)out.push(`stretched checkbox ${describe(box)}`);
    if(!label){if(!box.getAttribute('aria-label'))out.push(`checkbox without label ${describe(box)}`);continue;}
    let l=label.getBoundingClientRect();
    if(label.contains(box)){const text=document.createRange();text.setStartAfter(box);text.setEnd(label,label.childNodes.length);l=text.getBoundingClientRect();}
    if(l.left<r.right-1)out.push(`checkbox label is not beside its box: ${label.textContent}`);
    if(Math.abs((l.top+Math.min(l.height,20)/2)-(r.top+r.height/2))>8)out.push(`checkbox label is not aligned with its box: ${label.textContent}`);
   }
   for(const section of form.querySelectorAll('.form-section')){
    const items=[...section.querySelectorAll(':scope > .field, :scope > .check, :scope > .choice-list, :scope > .privilege-tags, :scope > .form-grid > *')].filter(visible);
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
     const a=items[i].getBoundingClientRect(),b=items[j].getBoundingClientRect();
     if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)out.push(`fields overlap: ${describe(items[i])} / ${describe(items[j])}`);
    }
    for(const item of section.children){const m=getComputedStyle(item);if(item.tagName!=='LEGEND'&&(parseFloat(m.marginTop)>0||parseFloat(m.marginBottom)>0)&&!item.matches('.section-hint'))out.push(`section child sets its own vertical margin (use the section gap): ${describe(item)}`);}
   }
  }
  return out;
 },selector);
 if(problems.length)throw new Error(`Form layout:\n- ${problems.join('\n- ')}`);
}
