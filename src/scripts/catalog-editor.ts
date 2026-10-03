/**
 * Catalog editor: edits the catalog published by the collector (catalog.json, embedded in the
 * page as JSON) and generates config/projects.yaml. Runs entirely in the browser: no network
 * calls, no persistence, no token. Every node is built with createElement/textContent.
 */
import type { Catalog } from '@model/catalog';
import { VersionSourceSchema } from '@model/catalog';
import { ComponentTypeSchema, LifecycleSchema, type ControlId } from '@model/enums';
import type { Dict } from '../i18n/en';
import {
  DEFAULT_MANIFEST_PATH,
  DEFAULT_SECURITY_STATUS_PATH,
  addSuggestedComponent,
  catalogToYaml,
  emptyComponent,
  emptyEnvironment,
  emptyProject,
  emptyWorkflow,
  fill,
  isSubmoduleMapped,
  renameComponentId,
  toDraft,
  validateDraft,
  type DraftCatalog,
  type DraftProject,
  type EditorIssue,
  type UnmappedSubmodule,
} from '../lib/catalog-editor-core';

type Strings = Dict['catalogEditor'] & {
  lifecycle: Dict['lifecycle'];
  componentType: Dict['componentType'];
  control: Dict['control'];
  controlIds: ControlId[];
};
interface EditorData {
  catalog: Catalog;
  suggestions: { projectId: string; unmappedSubmodules: UnmappedSubmodule[] }[];
}
type Path = (string | number)[];
type Child = Node | string | null | undefined | false;

const readJson = <T>(id: string): T | null => {
  try {
    return JSON.parse(document.getElementById(id)?.textContent ?? 'null') as T | null;
  } catch {
    return null;
  }
};

const root = document.querySelector<HTMLElement>('[data-catalog-editor]');
const data = readJson<EditorData>('catalog-data');
const S = readJson<Strings>('catalog-i18n');

if (root && data && S) start(root, data, S);

function start(root: HTMLElement, data: EditorData, S: Strings) {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const projectsEl = $<HTMLUListElement>('[data-ce-projects]');
  const suggestionsEl = $<HTMLElement>('[data-ce-suggestions]');
  const form = $<HTMLFormElement>('[data-ce-form]');
  const formTitle = $<HTMLElement>('[data-ce-form-title]');
  const formBody = $<HTMLElement>('[data-ce-form-body]');
  const validationEl = $<HTMLElement>('[data-ce-validation]');
  const yamlEl = $<HTMLTextAreaElement>('[data-ce-yaml]');
  const statusEl = $<HTMLElement>('[data-ce-status]');

  let draft: DraftCatalog;
  let suggestionsFor: WeakMap<DraftProject, UnmappedSubmodule[]>;
  let selected = 0;
  let lastSignature: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function init() {
    draft = toDraft(data.catalog);
    suggestionsFor = new WeakMap();
    for (const p of draft.projects) {
      const s = data.suggestions.find((x) => x.projectId === p.id);
      suggestionsFor.set(p, s ? s.unmappedSubmodules : []);
    }
    selected = 0;
  }

  /* ---------- DOM helpers (no innerHTML) ---------- */

  function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | boolean | undefined> = {},
    ...children: Child[]
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  const fid = (path: Path) => `ce-${path.join('-')}`;
  const key = (path: Path) => path.join('.');

  function fieldShell(
    path: Path,
    label: string,
    control: HTMLElement,
    opts: { hint?: string; optional?: boolean; wide?: boolean } = {},
  ) {
    const id = fid(path);
    const describedBy = [opts.hint ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' ');
    control.id = id;
    control.dataset.path = key(path);
    control.setAttribute('aria-describedby', describedBy);
    return h(
      'div',
      { class: opts.wide ? 'ce-field ce-field--wide' : 'ce-field' },
      h(
        'label',
        { for: id },
        label,
        opts.optional && h('span', { class: 'ce-optional' }, ` (${S.optional})`),
      ),
      control,
      opts.hint && h('p', { class: 'ce-hint', id: `${id}-hint` }, opts.hint),
      h('p', { class: 'ce-error', id: `${id}-err`, hidden: true }),
    );
  }

  function textField(
    path: Path,
    label: string,
    value: string,
    onInput: (v: string) => void,
    opts: { hint?: string; optional?: boolean; placeholder?: string; mono?: boolean } = {},
  ) {
    const input = h('input', {
      type: 'text',
      class: opts.mono ? 'ce-input ce-input--mono' : 'ce-input',
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
      placeholder: opts.placeholder,
      required: !opts.optional,
    });
    input.value = value;
    input.addEventListener('input', () => {
      onInput(input.value);
      schedule();
    });
    return fieldShell(path, label, input, opts);
  }

  function textArea(path: Path, label: string, value: string, onInput: (v: string) => void) {
    const ta = h('textarea', { class: 'ce-input', rows: '2' });
    ta.value = value;
    ta.addEventListener('input', () => {
      onInput(ta.value);
      schedule();
    });
    return fieldShell(path, label, ta, { optional: true, wide: true });
  }

  function selectField(
    path: Path,
    label: string,
    value: string,
    options: readonly (readonly [string, string])[],
    onChange: (v: string) => void,
    opts: { hint?: string } = {},
  ) {
    const select = h('select', { class: 'ce-input' });
    for (const [v, l] of options) {
      const o = h('option', { value: v }, l);
      o.selected = v === value;
      select.append(o);
    }
    select.addEventListener('change', () => {
      onChange(select.value);
      schedule();
    });
    return fieldShell(path, label, select, opts);
  }

  function checkbox(path: Path, label: string, checked: boolean, onChange: (v: boolean) => void) {
    const id = fid(path);
    const input = h('input', { type: 'checkbox', id, 'data-path': key(path) });
    input.checked = checked;
    input.addEventListener('change', () => {
      onChange(input.checked);
      schedule();
    });
    return h('label', { class: 'ce-check', for: id }, input, h('span', {}, label));
  }

  function checkGroup(
    path: Path,
    legend: string,
    options: readonly (readonly [string, string])[],
    selectedValues: string[],
    onChange: (values: string[]) => void,
    hint?: string,
  ) {
    const id = fid(path);
    const boxes = options.map(([v], i) => {
      const input = h('input', { type: 'checkbox', id: `${id}-${i}`, value: v });
      input.checked = selectedValues.includes(v);
      input.addEventListener('change', () => {
        onChange(boxes.filter((b) => b.checked).map((b) => b.value));
        schedule();
      });
      return input;
    });
    const fs = h(
      'fieldset',
      {
        class: 'ce-checks',
        id,
        'data-path': key(path),
        'aria-describedby': [hint ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' '),
      },
      h('legend', {}, legend, h('span', { class: 'ce-optional' }, ` (${S.optional})`)),
      hint && h('p', { class: 'ce-hint', id: `${id}-hint` }, hint),
      h(
        'div',
        { class: 'ce-checks__list' },
        ...boxes.map((b, i) =>
          h('label', { class: 'ce-check', for: b.id }, b, h('span', {}, options[i]![1])),
        ),
      ),
      h('p', { class: 'ce-error', id: `${id}-err`, hidden: true }),
    );
    return fs;
  }

  function button(
    label: string,
    onClick: () => void,
    opts: { variant?: 'primary' | 'danger' | 'ghost'; focusKey?: string } = {},
  ) {
    const b = h(
      'button',
      {
        type: 'button',
        class: opts.variant ? `btn btn--${opts.variant}` : 'btn',
        'data-focus-key': opts.focusKey,
      },
      label,
    );
    b.addEventListener('click', onClick);
    return b;
  }

  function section(title: string, id: string, help: string | null, ...children: Child[]) {
    return h(
      'section',
      { class: 'card ce-section', 'aria-labelledby': id },
      h('h3', { id, class: 'h3' }, title),
      help && h('p', { class: 'note' }, help),
      ...children,
    );
  }

  const controlOptions = () => S.controlIds.map((c) => [c, S.control[c]] as const);

  /* ---------- Rendering ---------- */

  function renderProjects() {
    projectsEl.replaceChildren(
      ...draft.projects.map((p, i) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'ce-project',
              'data-index': String(i),
              'aria-current': i === selected ? 'true' : undefined,
            },
            h('span', { class: 'ce-project__name' }, p.name.trim() || S.untitled),
            h('code', { class: 'sub' }, p.id.trim() || '—'),
          ),
        ),
      ),
    );
    if (!draft.projects.length) projectsEl.append(h('li', { class: 'note' }, S.noProjects));
  }

  function renderSuggestions() {
    const p = draft.projects[selected];
    const list = p ? (suggestionsFor.get(p) ?? []) : [];
    if (!p || !list.length) {
      suggestionsEl.replaceChildren(h('p', { class: 'note' }, S.noSuggestions));
      return;
    }
    suggestionsEl.replaceChildren(
      h(
        'ul',
        { class: 'ce-suggestions' },
        ...list.map((s, i) => {
          const pathId = `ce-sugg-${i}`;
          const mapped = isSubmoduleMapped(p, s.path);
          let action: HTMLElement;
          if (mapped) {
            action = h(
              'span',
              { class: 'pill' },
              h('span', { 'aria-hidden': 'true' }, '✓'),
              S.linked,
            );
          } else {
            action = button(S.addAsComponent, () => addSuggestion(p, s));
            action.setAttribute('aria-describedby', pathId);
          }
          return h(
            'li',
            { class: 'ce-suggestion' },
            h('code', { id: pathId }, s.path),
            s.repository
              ? h('span', { class: 'sub' }, s.repository)
              : h('span', { class: 'sub' }, S.unknownRepository),
            action,
          );
        }),
      ),
    );
  }

  function updateTitle() {
    const p = draft.projects[selected];
    formTitle.textContent = p
      ? fill(S.editing, { name: p.name.trim() || p.id.trim() || S.untitled })
      : S.title;
  }

  let workflowsHost: HTMLElement | null = null;

  function renderForm() {
    const p = draft.projects[selected];
    updateTitle();
    if (!p) {
      formBody.replaceChildren(h('p', { class: 'card note' }, S.noProjects));
      workflowsHost = null;
      return;
    }
    const base: Path = ['projects', selected];
    workflowsHost = h('div', {});
    formBody.replaceChildren(
      generalSection(p, base),
      coordinatorSection(p, base),
      componentsSection(p, base),
      environmentsSection(p, base),
      section(S.workflows, 'ce-h-workflows', null, workflowsHost),
      securitySection(p, base),
    );
    renderWorkflows(p, base);
  }

  function generalSection(p: DraftProject, base: Path) {
    const onLabel = () => {
      renderProjects();
      updateTitle();
    };
    return section(
      S.general,
      'ce-h-general',
      null,
      h(
        'div',
        { class: 'ce-grid' },
        textField(
          [...base, 'id'],
          S.field.id,
          p.id,
          (v) => {
            p.id = v;
            onLabel();
          },
          { hint: S.hint.id, mono: true },
        ),
        textField([...base, 'name'], S.field.name, p.name, (v) => {
          p.name = v;
          onLabel();
        }),
        textField(
          [...base, 'businessUnit'],
          S.field.businessUnit,
          p.businessUnit,
          (v) => (p.businessUnit = v),
        ),
        selectField(
          [...base, 'lifecycle'],
          S.field.lifecycle,
          p.lifecycle,
          LifecycleSchema.options.map((l) => [l, S.lifecycle[l]] as const),
          (v) => (p.lifecycle = v),
        ),
        textArea(
          [...base, 'description'],
          S.field.description,
          p.description,
          (v) => (p.description = v),
        ),
        textField(
          [...base, 'securityStatusPath'],
          S.field.securityStatusPath,
          p.securityStatusPath,
          (v) => (p.securityStatusPath = v),
          {
            optional: true,
            hint: S.hint.securityStatusPath,
            placeholder: DEFAULT_SECURITY_STATUS_PATH,
            mono: true,
          },
        ),
      ),
      h(
        'div',
        { class: 'ce-actions' },
        button(S.removeProject, () => removeProject(p), { variant: 'danger' }),
      ),
    );
  }

  function coordinatorSection(p: DraftProject, base: Path) {
    const b: Path = [...base, 'coordinator'];
    const c = p.coordinator;
    return section(
      S.coordinator,
      'ce-h-coordinator',
      S.coordinatorHelp,
      h(
        'div',
        { class: 'ce-grid' },
        textField(
          [...b, 'repository'],
          S.field.repository,
          c.repository,
          (v) => (c.repository = v),
          {
            hint: S.hint.repository,
            mono: true,
          },
        ),
        textField(
          [...b, 'defaultBranch'],
          S.field.defaultBranch,
          c.defaultBranch,
          (v) => (c.defaultBranch = v),
          { optional: true, hint: S.hint.defaultBranch, mono: true },
        ),
        textField(
          [...b, 'manifestPath'],
          S.field.manifestPath,
          c.manifestPath,
          (v) => (c.manifestPath = v),
          {
            optional: true,
            hint: S.hint.manifestPath,
            placeholder: DEFAULT_MANIFEST_PATH,
            mono: true,
          },
        ),
      ),
      checkGroup(
        [...b, 'notApplicableControls'],
        S.field.notApplicableControls,
        controlOptions(),
        c.notApplicableControls,
        (v) => (c.notApplicableControls = v as ControlId[]),
        S.hint.notApplicableControls,
      ),
    );
  }

  function componentsSection(p: DraftProject, base: Path) {
    const rows = p.components.map((c, j) => {
      const b: Path = [...base, 'components', j];
      const n = j + 1;
      const vsHintId = `${fid([...b, 'versionSource'])}-hint`;
      const versionSource = selectField(
        [...b, 'versionSource'],
        S.field.versionSource,
        c.versionSource,
        VersionSourceSchema.options.map((v) => [v, S.versionSourceOption[v]] as const),
        (v) => {
          c.versionSource = v as typeof c.versionSource;
          const hint = document.getElementById(vsHintId);
          if (hint) hint.textContent = S.versionSourceHelp[c.versionSource];
        },
        { hint: S.versionSourceHelp[c.versionSource] },
      );
      return h(
        'fieldset',
        { class: 'ce-row' },
        h('legend', {}, fill(S.componentN, { n })),
        h(
          'div',
          { class: 'ce-grid' },
          textField(
            [...b, 'id'],
            S.field.id,
            c.id,
            (v) => {
              renameComponentId(p, c.id, v);
              c.id = v;
              renderWorkflows(p, base);
            },
            { hint: S.hint.id, mono: true },
          ),
          textField([...b, 'name'], S.field.name, c.name, (v) => (c.name = v)),
          textField(
            [...b, 'repository'],
            S.field.repository,
            c.repository,
            (v) => (c.repository = v),
            {
              hint: S.hint.repository,
              mono: true,
            },
          ),
          selectField(
            [...b, 'type'],
            S.field.type,
            c.type,
            ComponentTypeSchema.options.map((t) => [t, S.componentType[t]] as const),
            (v) => (c.type = v),
          ),
          textField(
            [...b, 'submodulePath'],
            S.field.submodulePath,
            c.submodulePath,
            (v) => {
              c.submodulePath = v;
              renderSuggestions();
            },
            { optional: true, hint: S.hint.submodulePath, mono: true },
          ),
          versionSource,
          textField(
            [...b, 'defaultBranch'],
            S.field.defaultBranch,
            c.defaultBranch,
            (v) => (c.defaultBranch = v),
            { optional: true, hint: S.hint.defaultBranch, mono: true },
          ),
          textField(
            [...b, 'releaseTagPrefix'],
            S.field.releaseTagPrefix,
            c.releaseTagPrefix,
            (v) => (c.releaseTagPrefix = v),
            { optional: true, hint: S.hint.releaseTagPrefix, mono: true },
          ),
        ),
        checkGroup(
          [...b, 'notApplicableControls'],
          S.field.notApplicableControls,
          controlOptions(),
          c.notApplicableControls,
          (v) => (c.notApplicableControls = v as ControlId[]),
          S.hint.notApplicableControls,
        ),
        h(
          'div',
          { class: 'ce-actions' },
          button(
            fill(S.removeComponent, { n }),
            () => {
              p.components.splice(j, 1);
              rerender('add-component');
            },
            { variant: 'ghost' },
          ),
        ),
      );
    });
    return section(
      S.components,
      'ce-h-components',
      S.componentsHelp,
      ...rows,
      h(
        'div',
        { class: 'ce-actions' },
        button(
          S.addComponent,
          () => {
            p.components.push(emptyComponent());
            rerender(key([...base, 'components', p.components.length - 1, 'id']));
          },
          { focusKey: 'add-component' },
        ),
      ),
    );
  }

  function environmentsSection(p: DraftProject, base: Path) {
    const rows = p.environments.map((e, j) => {
      const b: Path = [...base, 'environments', j];
      const n = j + 1;
      return h(
        'fieldset',
        { class: 'ce-row ce-row--inline' },
        h('legend', {}, fill(S.environmentN, { n })),
        h(
          'div',
          { class: 'ce-grid' },
          textField([...b, 'id'], S.field.id, e.id, (v) => (e.id = v), {
            hint: S.hint.id,
            mono: true,
          }),
          textField([...b, 'name'], S.field.name, e.name, (v) => (e.name = v)),
        ),
        h(
          'div',
          { class: 'ce-actions' },
          button(
            fill(S.removeEnvironment, { n }),
            () => {
              p.environments.splice(j, 1);
              rerender('add-environment');
            },
            { variant: 'ghost' },
          ),
        ),
      );
    });
    return section(
      S.environments,
      'ce-h-environments',
      null,
      ...rows,
      h(
        'div',
        { class: 'ce-actions' },
        button(
          S.addEnvironment,
          () => {
            p.environments.push(emptyEnvironment());
            rerender(key([...base, 'environments', p.environments.length - 1, 'id']));
          },
          { focusKey: 'add-environment' },
        ),
      ),
    );
  }

  function renderWorkflows(p: DraftProject, base: Path) {
    if (!workflowsHost) return;
    const ids = ['coordinator', ...p.components.map((c) => c.id.trim()).filter(Boolean)];
    const rows = p.trackedWorkflows.map((w, j) => {
      const b: Path = [...base, 'trackedWorkflows', j];
      const n = j + 1;
      // Unknown targets stay visible (and flagged by validation) so they can be unticked.
      const targets = [...new Set([...ids, ...w.appliesTo])];
      return h(
        'fieldset',
        { class: 'ce-row' },
        h('legend', {}, fill(S.workflowN, { n })),
        h(
          'div',
          { class: 'ce-grid' },
          textField([...b, 'id'], S.field.id, w.id, (v) => (w.id = v), {
            hint: S.hint.id,
            mono: true,
          }),
          textField([...b, 'name'], S.field.name, w.name, (v) => (w.name = v)),
          textField([...b, 'file'], S.field.file, w.file, (v) => (w.file = v), {
            hint: S.hint.file,
            mono: true,
          }),
          h(
            'div',
            { class: 'ce-field ce-field--check' },
            checkbox([...b, 'critical'], S.field.critical, w.critical, (v) => (w.critical = v)),
          ),
        ),
        checkGroup(
          [...b, 'appliesTo'],
          S.field.appliesTo,
          targets.map((t) => [t, t === 'coordinator' ? S.coordinator : t] as const),
          w.appliesTo,
          (v) => (w.appliesTo = v),
          S.hint.appliesTo,
        ),
        h(
          'div',
          { class: 'ce-actions' },
          button(
            fill(S.removeWorkflow, { n }),
            () => {
              p.trackedWorkflows.splice(j, 1);
              rerender('add-workflow');
            },
            { variant: 'ghost' },
          ),
        ),
      );
    });
    workflowsHost.replaceChildren(
      ...rows,
      h(
        'div',
        { class: 'ce-actions' },
        button(
          S.addWorkflow,
          () => {
            p.trackedWorkflows.push(emptyWorkflow());
            rerender(key([...base, 'trackedWorkflows', p.trackedWorkflows.length - 1, 'id']));
          },
          { focusKey: 'add-workflow' },
        ),
      ),
    );
    markIssues(currentIssues);
  }

  function securitySection(p: DraftProject, base: Path) {
    return section(
      S.security,
      'ce-h-security',
      S.securityHelp,
      h(
        'fieldset',
        { class: 'ce-checks' },
        h('legend', {}, S.required),
        h(
          'div',
          { class: 'ce-checks__list' },
          ...S.controlIds.map((c) =>
            checkbox(
              [...base, 'securityControls', c, 'required'],
              S.control[c],
              p.securityControls[c],
              (v) => (p.securityControls[c] = v),
            ),
          ),
        ),
      ),
    );
  }

  /* ---------- Validation & output ---------- */

  let currentIssues: EditorIssue[] = [];

  function markIssues(issues: EditorIssue[]) {
    for (const el of form.querySelectorAll<HTMLElement>('[data-path]')) {
      el.removeAttribute('aria-invalid');
      const err = document.getElementById(`${el.id}-err`);
      if (err) {
        err.hidden = true;
        err.textContent = '';
      }
    }
    for (const issue of issues) {
      const el = form.querySelector<HTMLElement>(`[data-path="${CSS.escape(issue.key)}"]`);
      if (!el) continue;
      el.setAttribute('aria-invalid', 'true');
      const err = document.getElementById(`${el.id}-err`);
      if (err) {
        err.textContent = err.textContent ? `${err.textContent} · ${issue.message}` : issue.message;
        err.hidden = false;
      }
    }
  }

  function renderValidation(issues: EditorIssue[]) {
    const signature = issues.map((i) => i.text).join('\n');
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (!issues.length) {
      validationEl.replaceChildren(
        h(
          'p',
          { class: 'ce-summary ce-summary--ok' },
          h('span', { 'aria-hidden': 'true' }, '✓ '),
          S.valid,
        ),
      );
      return;
    }
    validationEl.replaceChildren(
      h(
        'p',
        { class: 'ce-summary ce-summary--bad' },
        h('span', { 'aria-hidden': 'true' }, '✕ '),
        fill(S.invalid, { count: issues.length }),
      ),
      h(
        'ul',
        { class: 'ce-issues' },
        ...issues.map((issue) => {
          const b = h('button', { type: 'button', class: 'ce-issue' }, issue.text);
          b.addEventListener('click', () => goToIssue(issue));
          return h('li', {}, b);
        }),
      ),
    );
  }

  function goToIssue(issue: EditorIssue) {
    const [head, index] = issue.path;
    if (head === 'projects' && typeof index === 'number' && index !== selected) {
      selected = index;
      renderAll();
    }
    // Focus the field, or the closest enclosing one (e.g. duplicate ids → the list).
    for (let n = issue.path.length; n > 0; n--) {
      const el = form.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(key(issue.path.slice(0, n)))}"]`,
      );
      if (el) {
        const target =
          el.tagName === 'FIELDSET' ? (el.querySelector<HTMLElement>('input') ?? el) : el;
        target.focus();
        return;
      }
    }
  }

  function update() {
    clearTimeout(timer);
    yamlEl.value = catalogToYaml(draft);
    currentIssues = validateDraft(draft);
    markIssues(currentIssues);
    renderValidation(currentIssues);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  }

  function announce(message: string) {
    statusEl.textContent = '';
    requestAnimationFrame(() => (statusEl.textContent = message));
  }

  /* ---------- Actions ---------- */

  function renderAll() {
    renderProjects();
    renderSuggestions();
    renderForm();
    update();
  }

  /** Re-renders the form after a structural change and moves focus to a meaningful place. */
  function rerender(focus: string) {
    renderForm();
    renderSuggestions();
    update();
    const el =
      form.querySelector<HTMLElement>(`[data-path="${CSS.escape(focus)}"]`) ??
      form.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focus)}"]`);
    el?.focus();
  }

  function addSuggestion(p: DraftProject, s: UnmappedSubmodule) {
    const c = addSuggestedComponent(p, s);
    rerender(key(['projects', selected, 'components', p.components.length - 1, 'id']));
    announce(fill(S.suggestionAdded, { id: c.id, path: s.path }));
  }

  function selectProject(i: number) {
    selected = i;
    renderAll();
    projectsEl.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }

  function removeProject(p: DraftProject) {
    const i = draft.projects.indexOf(p);
    if (i < 0) return;
    draft.projects.splice(i, 1);
    selected = Math.max(0, Math.min(selected, draft.projects.length - 1));
    renderAll();
    (
      projectsEl.querySelector<HTMLElement>('[aria-current="true"]') ??
      root.querySelector<HTMLElement>('[data-ce-new]')
    )?.focus();
    announce(fill(S.projectRemoved, { name: p.name.trim() || p.id.trim() || S.untitled }));
  }

  projectsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
    if (b) selectProject(Number(b.dataset.index));
  });

  $<HTMLButtonElement>('[data-ce-new]').addEventListener('click', () => {
    const p = emptyProject(draft.projects.map((x) => x.id));
    suggestionsFor.set(p, []);
    draft.projects.push(p);
    selected = draft.projects.length - 1;
    renderAll();
    form.querySelector<HTMLElement>(`[data-path="projects.${selected}.name"]`)?.focus();
    announce(S.projectAdded);
  });

  $<HTMLButtonElement>('[data-ce-reset]').addEventListener('click', () => {
    init();
    renderAll();
    announce(S.resetDone);
  });

  $<HTMLButtonElement>('[data-ce-copy]').addEventListener('click', async () => {
    update();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(yamlEl.value);
      announce(S.copied);
    } catch {
      yamlEl.focus();
      yamlEl.select();
      announce(S.copyFallback);
    }
  });

  $<HTMLButtonElement>('[data-ce-download]').addEventListener('click', () => {
    update();
    const url = URL.createObjectURL(new Blob([yamlEl.value], { type: 'text/yaml;charset=utf-8' }));
    const a = h('a', { href: url, download: 'projects.yaml', hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(S.downloaded);
  });

  form.addEventListener('submit', (e) => e.preventDefault());

  init();
  renderAll();
}
