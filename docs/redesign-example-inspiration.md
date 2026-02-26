<!DOCTYPE html>

<html lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Agent Annotations Terminal</title>
<!-- Tailwind CSS CDN -->
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<!-- Google Fonts for Monospaced Typography -->
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&amp;display=swap" rel="stylesheet"/>
<script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            mono: ['"Roboto Mono"', 'monospace'],
          },
          colors: {
            terminal: {
              bg: '#f0f0f0',
              text: '#1a1a1a',
              border: '#1a1a1a',
              accent: '#3b82f6',
              bug: '#ef4444',
              feature: '#f59e0b',
              info: '#3b82f6',
            }
          }
        }
      }
    }
  </script>
<style data-purpose="global-styles">
    body {
      background-color: #f0f0f0;
      color: #1a1a1a;
      font-family: 'Roboto Mono', monospace;
    }
    /* Removing rounded corners globally for the brutalist aesthetic */
    * {
      border-radius: 0 !important;
    }
    /* Custom Scrollbar for a cleaner terminal look */
    ::-webkit-scrollbar {
      width: 4px;
    }
    ::-webkit-scrollbar-track {
      background: #f0f0f0;
    }
    ::-webkit-scrollbar-thumb {
      background: #1a1a1a;
    }
  </style>
</head>
<body class="min-h-screen flex flex-col p-4">
<!-- BEGIN: MainHeader -->
<header class="border-b-2 border-terminal-border pb-4 mb-6 flex justify-between items-end" data-purpose="app-header">
<div>
<h1 class="text-xl font-bold tracking-tighter uppercase">Agent Annotations</h1>
<p class="text-xs mt-1 text-gray-600">URL: http://localhost:8789</p>
</div>
<div class="text-xs font-bold text-green-600 animate-pulse">
      [CONNECTED]
    </div>
</header>
<!-- END: MainHeader -->
<main class="flex-grow space-y-8">
<!-- BEGIN: ModeToggle -->
<section class="flex justify-between items-center border border-terminal-border p-3" data-purpose="mode-toggle">
<div>
<h2 class="text-sm font-bold uppercase">Annotate Mode</h2>
<p class="text-xs text-gray-500">Select elements to highlight</p>
</div>
<label class="inline-flex items-center cursor-pointer">
<input class="sr-only peer" type="checkbox"/>
<div class="w-12 h-6 border-2 border-terminal-border flex items-center px-1 bg-white peer-checked:bg-terminal-text transition-colors">
<div class="w-3 h-3 bg-terminal-border peer-checked:bg-white"></div>
</div>
</label>
</section>
<!-- END: ModeToggle -->
<!-- BEGIN: ActionButtons -->
<section class="grid grid-cols-3 gap-2" data-purpose="primary-actions">
<!-- Fullscreen Button -->
<button class="border border-terminal-border p-3 text-xs font-bold hover:bg-black hover:text-white transition-colors flex flex-col items-center gap-1">
<svg fill="currentColor" height="16" viewbox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
<path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"></path>
</svg>
        FULLSCREEN
      </button>
<!-- Element Button -->
<button class="border border-terminal-border p-3 text-xs font-bold hover:bg-black hover:text-white transition-colors flex flex-col items-center gap-1">
<svg fill="currentColor" height="16" viewbox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
<path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"></path>
<path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"></path>
</svg>
        ELEMENT
      </button>
<!-- Clear Button -->
<button class="border border-terminal-border p-3 text-xs font-bold hover:bg-black hover:text-white transition-colors flex flex-col items-center gap-1">
<svg fill="currentColor" height="16" viewbox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"></path>
<path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" fill-rule="evenodd"></path>
</svg>
        CLEAR
      </button>
</section>
<!-- END: ActionButtons -->
<!-- BEGIN: SelectedElement -->
<section data-purpose="element-selection">
<div class="flex justify-between items-center mb-2">
<label class="text-xs font-bold uppercase tracking-widest text-gray-500">Selected Element</label>
<div class="flex gap-4">
<button class="text-xs font-bold underline hover:no-underline uppercase">Change</button>
<button class="text-xs font-bold uppercase">X</button>
</div>
</div>
<div class="border-l-4 border-terminal-border bg-white p-4 text-sm font-mono italic">
        [ NONE ]
      </div>
</section>
<!-- END: SelectedElement -->
<!-- BEGIN: CommentInput -->
<section data-purpose="comment-field">
<label class="block text-xs font-bold uppercase tracking-widest mb-2 text-gray-500">Comment</label>
<textarea class="w-full border-t-0 border-l-0 border-r-0 border-b-2 border-terminal-border bg-transparent focus:ring-0 focus:border-black p-0 text-sm font-mono placeholder-gray-400" placeholder="Type annotation here..." rows="3"></textarea>
</section>
<!-- END: CommentInput -->
<!-- BEGIN: SeveritySelector -->
<section data-purpose="severity-selection">
<label class="block text-xs font-bold uppercase tracking-widest mb-3 text-gray-500">Severity</label>
<div class="flex flex-wrap gap-2">
<!-- Bug -->
<button class="flex items-center gap-2 border border-terminal-border px-3 py-1 bg-white hover:bg-red-50 transition-colors">
<span class="w-2 h-2 bg-terminal-bug"></span>
<span class="text-[10px] font-bold uppercase tracking-tighter">Bug</span>
</button>
<!-- New Feature -->
<button class="flex items-center gap-2 border border-terminal-border px-3 py-1 bg-white hover:bg-yellow-50 transition-colors">
<span class="w-2 h-2 bg-terminal-feature"></span>
<span class="text-[10px] font-bold uppercase tracking-tighter">New Feature</span>
</button>
<!-- Information -->
<button class="flex items-center gap-2 border border-terminal-border px-3 py-1 bg-white hover:bg-blue-50 transition-colors">
<span class="w-2 h-2 bg-terminal-info"></span>
<span class="text-[10px] font-bold uppercase tracking-tighter">Information</span>
</button>
</div>
</section>
<!-- END: SeveritySelector -->
<!-- BEGIN: UnresolvedAnnotations -->
<section data-purpose="unresolved-list">
<div class="flex justify-between items-center mb-4">
<h3 class="text-xs font-bold uppercase tracking-widest text-gray-500">Unresolved Annotations</h3>
<button class="text-[10px] font-bold underline uppercase">Refresh</button>
</div>
<div class="border-t border-dotted border-terminal-border py-4">
<p class="text-[11px] italic text-gray-400">No unresolved annotations for this page.</p>
</div>
</section>
<!-- END: UnresolvedAnnotations -->
</main>
<!-- BEGIN: FooterAction -->
<footer class="mt-8 pb-6" data-purpose="bottom-navigation">
<div class="mb-4">
<p class="text-[10px] font-bold uppercase text-gray-400">Connection Settings</p>
</div>
<button class="w-full bg-terminal-text text-white py-4 font-bold text-sm flex justify-center items-center gap-3 active:bg-gray-800">
      SEND ANNOTATION 
      <svg fill="currentColor" height="16" viewbox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
<path d="M15.854.146a.5.5 0 0 1 .11.304l-4.995 14.985a.5.5 0 0 1-.923.03l-3.526-7.051-7.051-3.526a.5.5 0 0 1 .03-.923L14.545.039a.5.5 0 0 1 .309.107z"></path>
</svg>
</button>
</footer>
<!-- END: FooterAction -->
</body></html>