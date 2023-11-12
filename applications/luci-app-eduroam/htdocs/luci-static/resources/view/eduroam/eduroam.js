'use strict';
'require view';
'require dom';
'require form';
'require rpc';
'require fs';
'require ui';

var isReadonlyView = !L.hasViewPermission();

function findStorageSize(procmtd, procpart) {
	var kernsize = 0, rootsize = 0, wholesize = 0;

	procmtd.split(/\n/).forEach(function(ln) {
		var match = ln.match(/^mtd\d+: ([0-9a-f]+) [0-9a-f]+ "(.+)"$/),
		    size = match ? parseInt(match[1], 16) : 0;

		switch (match ? match[2] : '') {
		case 'linux':
		case 'firmware':
			if (size > wholesize)
				wholesize = size;
			break;

		case 'kernel':
		case 'kernel0':
			kernsize = size;
			break;

		case 'rootfs':
		case 'rootfs0':
		case 'ubi':
		case 'ubi0':
			rootsize = size;
			break;
		}
	});

	if (wholesize > 0)
		return wholesize;
	else if (kernsize > 0 && rootsize > kernsize)
		return kernsize + rootsize;

	procpart.split(/\n/).forEach(function(ln) {
		var match = ln.match(/^\s*\d+\s+\d+\s+(\d+)\s+(\S+)$/);
		if (match) {
			var size = parseInt(match[1], 10);

			if (!match[2].match(/\d/) && size > 2048 && wholesize == 0)
				wholesize = size * 1024;
		}
	});

	return wholesize;
}

var mapdata = { actions: {}, config: {} };

return view.extend({
	load: function() {
		var tasks = [
			fs.trimmed('/proc/mtd'),
			fs.trimmed('/proc/partitions'),
			L.resolveDefault(fs.stat('/usr/bin/openssl'), {}),
			L.resolveDefault(fs.stat('/etc/easyroam-certs/create-cert.sh'), {}),
		];

		return Promise.all(tasks);
	},

	handleCertificateUpload: function(storage_size, ev) {
		return ui.uploadFile('/tmp/easyroam.p12', ev.target.firstChild)
			.then(L.bind(function(btn, reply) {
				btn.firstChild.data = _('Checking certificate…');

				ui.showModal(_('Checking certificate…'), [
					E('span', { 'class': 'spinning' }, _('Verifying the uploaded certificate file.'))
				]);

				return fs.exec('openssl', ['pkcs12', '-info', '-nodes', '-password', 'pass:', '-in', '/tmp/easyroam.p12'])
					.then(function(res) { return [ reply, res] });
			}, this, ev.target))
			.then(L.bind(function(btn, res) {
				var is_valid = res[1].code === 0,
					is_too_big = (storage_size > 0 && res[0].size > storage_size),
				    body = [];

				body.push(E('p', _("The certificate was uploaded. Below is the checksum and file size listed, compare them with the original file to ensure data integrity. <br /> Click 'Continue' below to start the configuration procedure.")));
				body.push(E('ul', {}, [
					res[0].size ? E('li', {}, '%s: %1024.2mB'.format(_('Size'), res[0].size)) : '',
					res[0].checksum ? E('li', {}, '%s: %s'.format(_('MD5'), res[0].checksum)) : '',
					res[0].sha256sum ? E('li', {}, '%s: %s'.format(_('SHA256'), res[0].sha256sum)) : ''
				]));

				var cntbtn = E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleCertificateUploadConfirm', btn),
				}, [ _('Continue') ]);
				 
				if (!is_valid || is_too_big) {
					body.push(E('hr'));
					cntbtn.disabled = true;
				}

				if (is_too_big)
					body.push(E('p', { 'class': 'alert-message' }, [
						_('It appears that you are trying to upload a certificate that does not fit into the flash memory, please verify the certificate file!')
					]));

				if (!is_valid)
					body.push(E('p', { 'class': 'alert-message' }, [
						_('The uploaded certificate file does not contain a supported format. Make sure that you choose the right certificate file.')
					]));

				body.push(E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'btn',
						'click': ui.createHandlerFn(this, function(ev) {
							return fs.remove('/tmp/easyroam.p12').finally(ui.hideModal);
						})
					}, [ _('Cancel') ]), ' ', cntbtn
				]));

				ui.showModal(_('Validate certificate'), body);
			}, this, ev.target))
			.catch(function(e) { ui.addNotification(null, E('p', e.message)) })
			.finally(L.bind(function(btn) {
				btn.firstChild.data = _('Upload certificate...');
			}, this, ev.target));
	},
	
	handleCertificateUploadConfirm: function(btn, ev) {
		ui.showModal(_('Creating config'), [
			E('p', { 'class': 'spinning' }, _('Creating the configuration.'))
		]);

		var certFile = 'easyroam.p12',
			certPath = '/etc/easyroam-certs/';

		fs.exec('mkdir', ['-p', certPath])
			.then(fs.exec('mv', ['/tmp/' + certFile, certPath + certFile]))
			.then(fs.exec(certPath + 'create-cert.sh', [certPath + certFile]))
			// .then(fs.exec('/etc/init.d/whnetz', ['stop']))
			// .then(fs.exec('/etc/init.d/whnetz', ['start']))
			.catch(function(e) { 
				console.log(e);
				ui.addNotification(null, E('p', e.message));
			})
			.finally(function() {
				ui.addNotification(null, 'Successfully updated config');
				ui.hideModal()
			})

	},

	renderWithOpenssl: function(res) {
		var procmtd = res[0],
		    procpart = res[1],
			// Checking if the script exist and if openssl is installed
			allow_file_upload = (res[2].type == 'file') && (res[3].type == 'file'),
		    storage_size = findStorageSize(procmtd, procpart),
		    m, s, o, ss;

		m = new form.JSONMap(mapdata, _('Eduroam config'));
		m.readonly = isReadonlyView;

		s = m.section(form.NamedSection, 'actions', _('Actions'));


		o = s.option(form.SectionValue, 'actions', form.NamedSection, 'actions', 'actions', _('Upload certificate'),
			allow_file_upload
				? _('Upload the certificate (.p12 file) to create the eduroam configuration.')
				: _('Sorry, there is no file upload support present; a new certificate must be copied manually and the config has to be created manually.'));

		ss = o.subsection;

		if (allow_file_upload) {
			o = ss.option(form.Button, 'certificate_upload', _('Certificate'));
			o.inputstyle = 'action important';
			o.inputtitle = _('Upload certificate...');
			o.onclick = L.bind(this.handleCertificateUpload, this, storage_size);
			
			o = s.option(form.SectionValue, 'actions', form.NamedSection, 'actions', 'actions', 'Help',
				'Please follow the following steps to obtain the needed file:<br>'
				+ '1: Go to <a href="https://www.easyroam.de/" target="_blank">easyroam.de</a> and login by selecting you university and entering your login credentials.<br>'
				+ '2: Make sure you\'re on the "Generate Profile" page. If not select it on the top.<br>'
				+ '3: Click on "Manual options" on the bottom of the box in the screen center.<br>'
				+ '4: In the opend menu select the option "PKCS12" and enter a name for the certificate like router for example.<br>'
				+ '5: Click on the "Generate profile" button on the bottom.<br>'
				+ '6: With the certificate file downloaded come back to this page and select the upload button and upload the file.<br>'
				// + '7: The service for handeling the authetication should be restarted so the internet connection might be lost shortly if it had one.<br>'
				+ '7: Please restart the wpa_supplicant service or the router itself.<br>'
			);
		}
		
		return m.render();
	},
	
	renderWithoutOpenssl: function() {
		m = new form.JSONMap(mapdata, _('Eduroam config'), "Openssl not found");
		m.readonly = isReadonlyView;

		s = m.section(form.NamedSection, 'actions', _('Actions'));

		return m.render();
	},

	// res is result from load function
	render: function(res) {
		var openssl_installed = (res[2].type == 'file');
		return openssl_installed ? this.renderWithOpenssl(res) : this.renderWithoutOpenssl();
	}
});