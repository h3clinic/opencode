// Executed in WebKit's isolated client world. References belong to this document.
const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const label = el => el.getAttribute('aria-label') || el.labels?.[0]?.innerText ||
  el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '';
if (operation === 'snapshot') {
  const previous = globalThis.browserRefs || new Map();
  const byElement = new Map(Array.from(previous, ([key, el]) => [el, key]));
  const refs = new Map();
  const controls = [];
  for (const el of document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]')) {
    if (!visible(el)) continue;
    const ref = byElement.get(el) || Array.from(crypto.getRandomValues(new Uint32Array(3))).join("-");
    refs.set(ref, el);
    controls.push({ref, role:el.getAttribute('role') || el.localName, label:label(el).trim().slice(0,120)});
    if (controls.length >= 120) break;
  }
  globalThis.browserRefs = refs;
  return {url:location.href,title:document.title,text:(document.body?.innerText || '').slice(0,6000),controls};
}
const el = globalThis.browserRefs?.get(args.ref);
if (!el?.isConnected || !visible(el)) throw Error('Element changed. Take a new snapshot.');
if (el.disabled) throw Error('Control is disabled.');
el.scrollIntoView({block:'nearest'});
if (operation === 'click') {
  el.click();
} else if (operation === 'fill') {
  if (el.readOnly) throw Error('Field is read-only.');
  if (el.isContentEditable) el.textContent=args.text;
  else {
    if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement &&
      ['text','url','search','email','tel','number','password'].includes(el.type)))) throw Error('Choose a text field.');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,args.text);
  }
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
} else throw Error('Unknown operation.');
return {performed:operation};
