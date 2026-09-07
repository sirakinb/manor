/** Runs inside the provider's workspace. All file traversal uses no-follow directory descriptors. */
export const WORKSPACE_FILE_SCRIPT = String.raw`
import os, sys, json, stat, hashlib, base64, contextlib, subprocess, tempfile, fcntl

MAX_FILE = 10 * 1024 * 1024
MAX_TEXT = 2 * 1024 * 1024
MAX_ENTRIES = 2000
SKIP = {'.git', 'node_modules', '.cache', '.npm', '.pnpm-store', '.browser-profiles'}
class Failure(Exception):
    def __init__(self, message, code='BAD_REQUEST'):
        self.message, self.code = message, code

def parts(value, internal=False):
    if value == '': return []
    result = value.split('/')
    if value.startswith('/') or '\\' in value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise Failure('Use a relative workspace path')
    if any(p in ('', '.', '..') or (not internal and (p in ('.git', '.rakazo-files.lock') or p.startswith('.rakazo-transfer-'))) for p in result):
        raise Failure('Invalid workspace path')
    return result

@contextlib.contextmanager
def directory(relative, internal=False):
    fd = os.dup(ROOT)
    try:
        for segment in parts(relative, internal):
            nxt = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        yield fd
    finally: os.close(fd)

@contextlib.contextmanager
def parent(relative, internal=False):
    segments = parts(relative, internal)
    if not segments: raise Failure('Choose a file or folder')
    with directory('/'.join(segments[:-1]), internal) as fd:
        yield fd, segments[-1]

def info_at(fd, name):
    result = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if not (stat.S_ISREG(result.st_mode) or stat.S_ISDIR(result.st_mode)):
        raise Failure('Links and special files cannot be managed here')
    return result

def read_bytes(relative, maximum=MAX_FILE, internal=False):
    with parent(relative, internal) as (fd, name):
        f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(f, 'rb') as stream:
            s = os.fstat(stream.fileno())
            if not stat.S_ISREG(s.st_mode): raise Failure('Choose a regular file')
            if s.st_size > maximum: raise Failure('File is too large for this operation (10 MiB maximum)')
            data = stream.read(maximum + 1)
            if len(data) > maximum: raise Failure('File is too large for this operation')
            return data

def revision(relative):
    with parent(relative) as (fd, name):
        s = info_at(fd, name)
        if stat.S_ISREG(s.st_mode):
            if s.st_size <= MAX_FILE: return hashlib.sha256(read_bytes(relative)).hexdigest()
            # Large files can be moved/deleted without loading their bytes into API responses.
            return hashlib.sha256(('%s:%s:%s:%s:%s' % (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)).encode()).hexdigest()
    # Include descendants: a directory deletion must not discard unseen new work.
    digest = hashlib.sha256()
    count = [0]
    def walk(p):
        with directory(p, True) as fd:
            for name in sorted(os.listdir(fd)):
                count[0] += 1
                if count[0] > MAX_ENTRIES: raise Failure('Folder is too large to move or delete here')
                s = info_at(fd, name)
                child = p + '/' + name
                digest.update((child + ':' + str(s.st_mode) + ':' + str(s.st_mtime_ns) + ':' + str(s.st_size)).encode())
                if stat.S_ISDIR(s.st_mode): walk(child)
                else: digest.update(read_bytes(child, internal=True))
    walk(relative)
    return digest.hexdigest()

def remove_tree(parent_fd, name):
    # Works on Python 3.8+ and never follows symlinks, including ones introduced during deletion.
    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        for entry in os.listdir(child):
            s = os.stat(entry, dir_fd=child, follow_symlinks=False)
            if stat.S_ISDIR(s.st_mode): remove_tree(child, entry)
            else: os.unlink(entry, dir_fd=child)
    finally: os.close(child)
    os.rmdir(name, dir_fd=parent_fd)

def check_revision(relative, expected):
    if revision(relative) != expected:
        raise Failure('This file or folder changed. Refresh and review it before trying again.', 'CONFLICT')

def joined(base, relative):
    parts(base, True)
    parts(relative)
    return '/'.join(p for p in (base, relative) if p)

def ensure_absent(fd, name):
    try: os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError: return
    raise Failure('A file or folder already exists at that path', 'CONFLICT')

def file_result(relative, display, download):
    data = read_bytes(relative)
    ext = display.rsplit('.', 1)[-1].lower()
    mime = {'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp','pdf':'application/pdf','md':'text/markdown','markdown':'text/markdown'}.get(ext, 'application/octet-stream')
    content = None
    if mime == 'application/octet-stream' or mime == 'text/markdown':
        if len(data) <= MAX_TEXT and b'\x00' not in data:
            try:
                content = data.decode('utf-8')
                if mime == 'application/octet-stream': mime = 'text/plain'
            except UnicodeDecodeError: pass
    result = dict(kind='file', path=display, revision=hashlib.sha256(data).hexdigest(), content=content, mimeType=mime, size=len(data))
    if download or mime.startswith('image/') or mime == 'application/pdf':
        result['dataBase64'] = base64.b64encode(data).decode()
    return result

def git_command(fd, args, accepted=(0,), max_bytes=2*1024*1024):
    # User repository hooks, filters, credential helpers and remote transports are not part of these controls.
    env = {k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, LC_ALL='C')
    prefix = ['git', '--literal-pathspecs', '-c', 'submodule.recurse=false', '-c', 'core.hooksPath='+os.devnull, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'commit.gpgSign=false', '-c', 'protocol.allow=never']
    # Filters may execute while staging/checking out files. Reject configured filters rather than run them.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        proc = subprocess.run(prefix+args, preexec_fn=lambda: os.fchdir(fd), pass_fds=(fd,), env=env, stdout=out, stderr=err, timeout=15)
        out.seek(0); data = out.read(max_bytes+1)
        err.seek(0); detail = err.read(4000).decode('utf-8', 'replace')
    if proc.returncode not in accepted:
        # Do not return config contents or arbitrary absolute paths from Git stderr.
        if 'identity unknown' in detail or 'unable to auto-detect email' in detail:
            raise Failure('Set a Git author name and email in this repository before committing')
        if 'nothing to commit' in detail: raise Failure('There are no changes to commit')
        raise Failure('Git could not complete this operation. Check the repository and refresh.')
    if len(data) > max_bytes: raise Failure('Git output is too large to review here')
    return data

@contextlib.contextmanager
def repository(relative):
    with directory(relative) as fd:
        try:
            s = os.stat('.git', dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISDIR(s.st_mode): raise Failure('External Git directories and worktrees are not supported here')
            meta = os.open('.git', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                for name in ('config', 'HEAD', 'index', 'objects', 'refs', 'commondir'):
                    try: info_at(meta, name)
                    except FileNotFoundError: pass
                if 'commondir' in os.listdir(meta): raise Failure('External Git directories are not supported here')
            finally: os.close(meta)
        except FileNotFoundError: raise Failure('Choose a Git repository')
        # Disallow indirection to another worktree and executable checkout/staging filters.
        config = git_command(fd, ['config', '--no-includes', '--local', '--get-regexp', r'^(include\.|includeif\.|core\.worktree|filter\.)'], accepted=(0,1))
        if config: raise Failure('This repository uses external configuration or filters; manage Git from the bot terminal')
        yield fd

def git_files(fd):
    raw = git_command(fd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])
    result = []
    for entry in raw.split(b'\x00'):
        if not entry: continue
        code, name = entry[:2].decode(), entry[3:].decode('utf-8')
        # Nested repositories are reviewed separately, never staged as an ordinary file.
        try:
            if stat.S_ISDIR(os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode): continue
        except FileNotFoundError: pass
        parts(name)
        if code == '??': status = 'untracked'
        elif 'U' in code or code in ('AA','DD'): status = 'conflict'
        elif 'D' in code: status = 'deleted'
        elif 'A' in code: status = 'added'
        else: status = 'modified'
        result.append(dict(path=name, status=status))
    if len(result) > MAX_ENTRIES: raise Failure('Too many Git changes to review here')
    return result, raw

def git_revision(fd, relative, files, raw):
    digest = hashlib.sha256(raw)
    digest.update(git_command(fd, ['rev-parse', '--verify', 'HEAD'], accepted=(0,128)))
    digest.update(git_command(fd, ['symbolic-ref', '-q', 'HEAD'], accepted=(0,1)))
    for file in files:
        if file['status'] == 'deleted': continue
        digest.update(read_bytes(joined(relative, file['path'])))
    return digest.hexdigest()

def git_details(relative, display):
    with repository(relative) as fd:
        files, raw = git_files(fd)
        branch = git_command(fd, ['symbolic-ref', '--short', '-q', 'HEAD'], accepted=(0,1)).decode().strip() or 'Detached HEAD'
        branches = git_command(fd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).decode().splitlines()
        return dict(path=display, branch=branch, branches=branches, revision=git_revision(fd, relative, files, raw), files=files)

def run(req):
    op = req['operation']; action = op['action']; base = req['base']
    relative = joined(base, op.get('path', ''))
    if action == 'list':
        found = []; seen = [0]; truncated = [False]
        query = op.get('search', '').casefold()
        def walk(p, display, depth=0):
            if depth > 12: truncated[0] = True; return
            with directory(p) as fd:
                for name in sorted(os.listdir(fd)):
                    seen[0] += 1
                    if seen[0] > 10000 or len(found) >= MAX_ENTRIES: truncated[0] = True; return
                    if name.startswith('.rakazo-transfer-') or name in ('.rakazo-files.lock', '.git'): continue
                    if not op.get('hidden') and name.startswith('.'): continue
                    try: s = info_at(fd, name)
                    except Failure: continue
                    child = '/'.join(x for x in (display, name) if x)
                    if not query or query in child.casefold():
                        found.append(dict(path=child, kind='dir' if stat.S_ISDIR(s.st_mode) else 'file', size=s.st_size if stat.S_ISREG(s.st_mode) else 0))
                    if query and stat.S_ISDIR(s.st_mode) and name not in SKIP:
                        walk('/'.join(x for x in (p,name) if x), child, depth+1)
        walk(relative, op['path'])
        return dict(kind='list', entries=found, truncated=truncated[0])
    if action in ('read', 'download'): return file_result(relative, op['path'], action == 'download')
    if action == 'inspect': return dict(kind='revision', revision=revision(relative))
    if action == 'create':
        with parent(relative) as (fd, name):
            ensure_absent(fd, name)
            if op['kind'] == 'dir':
                os.mkdir(name, mode=0o700, dir_fd=fd)
                # Portable workspace snapshots transfer files. Preserve an otherwise empty folder.
                with directory(relative) as child:
                    f = os.open('.gitkeep', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=child)
                    os.close(f)
            else:
                f = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                os.close(f)
        return dict(kind='ok')
    if action in ('write','upload'):
        stage = req['stage']
        if not stage.startswith('.rakazo-transfer-') or '/' in stage: raise Failure('Invalid transfer')
        data = read_bytes(stage, internal=True)
        if action == 'write' and len(data) > MAX_TEXT: raise Failure('Text file is too large to edit')
        with parent(relative) as (fd, name):
            mode = 0o600
            if action == 'write':
                check_revision(relative, op['revision'])
                mode = info_at(fd, name).st_mode & 0o777
            else: ensure_absent(fd, name)
            with parent(stage, True) as (sfd, sname):
                source = os.open(sname, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=sfd)
                os.fchmod(source, mode)
                os.close(source)
                if action == 'upload':
                    os.link(sname, name, src_dir_fd=sfd, dst_dir_fd=fd, follow_symlinks=False)
                    os.unlink(sname, dir_fd=sfd)
                else: os.replace(sname, name, src_dir_fd=sfd, dst_dir_fd=fd)
        return dict(kind='revision', revision=hashlib.sha256(data).hexdigest())
    if action in ('move','delete'):
        check_revision(relative, op['revision'])
        with parent(relative) as (fd, name):
            s = info_at(fd, name)
            if action == 'delete':
                if stat.S_ISDIR(s.st_mode):
                    remove_tree(fd, name)
                else: os.unlink(name, dir_fd=fd)
            else:
                destination = joined(req['destinationBase'], op['destination'])
                if destination == relative or destination.startswith(relative+'/'): raise Failure('Choose a different destination')
                with parent(destination) as (dfd, dname):
                    ensure_absent(dfd, dname)
                    # Linux renameat2 atomically refuses replacement even if another writer races us.
                    import ctypes
                    libc = ctypes.CDLL(None, use_errno=True)
                    if hasattr(libc, 'renameat2'):
                        moved = libc.renameat2(fd, os.fsencode(name), dfd, os.fsencode(dname), 1)
                    elif hasattr(libc, 'renameatx_np'):
                        moved = libc.renameatx_np(fd, os.fsencode(name), dfd, os.fsencode(dname), 4)
                    else: raise Failure('Safe move is unavailable on this computer')
                    if moved != 0:
                        raise Failure('Move could not complete; the destination may already exist', 'CONFLICT')
        return dict(kind='ok')
    if action == 'git-status':
        repos = []; scanned = [0]; truncated = [False]
        def discover(p, display, depth=0):
            if depth > 8 or scanned[0] >= 2000 or len(repos) >= 30: truncated[0] = True; return
            scanned[0] += 1
            with directory(p) as fd:
                names = os.listdir(fd)
                if '.git' in names:
                    repos.append(git_details(p, display))
                for name in sorted(names):
                    if name in SKIP or name.startswith('.'): continue
                    s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(s.st_mode): discover('/'.join(x for x in (p,name) if x), '/'.join(x for x in (display,name) if x), depth+1)
        discover(base, '')
        return dict(kind='git', repos=repos, truncated=truncated[0])
    if action == 'git-init':
        with directory(relative) as fd:
            ensure_absent(fd, '.git')
            git_command(fd, ['init', '--initial-branch=main'])
        return dict(kind='ok')
    if action.startswith('git-'):
        with repository(relative) as fd:
            files, raw = git_files(fd)
            if action == 'git-diff':
                selected = next((f for f in files if f['path'] == op['file']), None)
                if selected is None: return dict(kind='diff', diff='No changes', truncated=False)
                # Validate every filesystem component before Git opens a file.
                if selected['status'] != 'deleted': read_bytes(joined(relative, op['file']))
                if selected['status'] == 'untracked':
                    data = git_command(fd, ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', os.devnull, op['file']], accepted=(0,1))
                else:
                    head = git_command(fd, ['rev-parse', '--verify', 'HEAD'], accepted=(0,128)).decode().strip()
                    if not head: head = git_command(fd, ['hash-object', '-t', 'tree', os.devnull]).decode().strip()
                    data = git_command(fd, ['diff', '--no-ext-diff', '--no-textconv', head, '--', op['file']])
                return dict(kind='diff', diff=data[:200*1024].decode('utf-8', 'replace'), truncated=len(data)>200*1024)
            if git_revision(fd, relative, files, raw) != op['revision']:
                raise Failure('The repository changed. Refresh and review it again.', 'CONFLICT')
            if action == 'git-branch':
                if files: raise Failure('Commit or resolve your changes before switching branches', 'CONFLICT')
                branch = op['branch']
                if branch.startswith('-'): raise Failure('Invalid branch name')
                git_command(fd, ['check-ref-format', '--branch', branch])
                git_command(fd, ['switch'] + (['-c'] if op['create'] else []) + [branch])
            elif action == 'git-commit':
                chosen = op['files']
                if any(name not in [f['path'] for f in files] for name in chosen): raise Failure('Choose changed files')
                if any(f['status'] == 'conflict' for f in files): raise Failure('Resolve merge conflicts before committing')
                # Literal pathspecs prevent a filename such as :(glob)** from selecting other files.
                literal = chosen
                git_command(fd, ['add', '--']+literal)
                identity = []
                if not git_command(fd, ['config', '--get', 'user.name'], accepted=(0,1)).strip(): identity += ['-c', 'user.name=Rakazo']
                if not git_command(fd, ['config', '--get', 'user.email'], accepted=(0,1)).strip(): identity += ['-c', 'user.email=workspace@rakazo.invalid']
                git_command(fd, identity+['commit', '--only', '-m', op['message'], '--']+literal)
            else: raise Failure('Unknown Git operation')
        return dict(kind='ok')
    raise Failure('Unknown file operation')

ROOT = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
req = json.loads(sys.argv[1])
try:
    lock = os.open('.rakazo-files.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=ROOT)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = run(req)
        print(json.dumps(dict(result=result)))
    finally: os.close(lock)
except Failure as e: print(json.dumps(dict(error=e.message, code=e.code)))
except FileNotFoundError: print(json.dumps(dict(error='File or folder no longer exists', code='NOT_FOUND')))
except FileExistsError: print(json.dumps(dict(error='Destination already exists', code='CONFLICT')))
except subprocess.TimeoutExpired: print(json.dumps(dict(error='Git timed out. Refresh before trying again.', code='TIMEOUT')))
except (OSError, ValueError, UnicodeError): print(json.dumps(dict(error='Cannot access this workspace path safely', code='BAD_REQUEST')))
finally:
    stage = req.get('stage', '')
    if stage.startswith('.rakazo-transfer-') and '/' not in stage:
        try: os.unlink(stage, dir_fd=ROOT)
        except FileNotFoundError: pass
    os.close(ROOT)
`;
