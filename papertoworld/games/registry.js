/* The list of games the Play menu shows. A new game is one line here plus one file (see README.md).
   Loaded as a plain script before the app, so the host reads it synchronously; if this file is missing the menu is just empty. */
window.PW_GAMES=[
  {id:'siege',name:'Paper Siege',icon:'🏰',blurb:'Topple card castles with a paper cannon',src:'games/siege.js'},
  {id:'storybook',name:'Living Storybook',icon:'📖',blurb:'Villagers, a fox and a journal that only tells what really happened',src:'games/storybook.js'},
  {id:'village',name:'Free Village',icon:'🏘️',blurb:'Eight villagers with minds of their own: set off events, follow anyone, read each day’s report',src:'games/village.js'},
];
